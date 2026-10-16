//! Lesson generation uses a small, ID-free wire format. The application supplies
//! persistence metadata and translates checked array indices into stable IDs.

use super::{
    CefrLevel, ChoiceData, Direction, Error, Exercise, ExerciseKind, InputLevel, Language, Lesson,
    LessonInput, LocalizedText, MatchPairsData, MatchingPair, Tile, WordBankData,
};
use rig_agent::agent::{Agent, AgentBuilder};
use rig_core::{DynModel, operation::Completion};
use schemars::JsonSchema;
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc};

#[derive(Deserialize, JsonSchema)]
struct GeneratedLesson {
    exercises: Vec<GeneratedExercise>,
}

#[derive(Deserialize, JsonSchema)]
struct GeneratedCommon {
    direction: Direction,
    instruction: String,
    prompt: Option<LocalizedText>,
    hint: String,
    explanation: String,
    #[serde(default)]
    grammar_focus: Vec<String>,
    #[serde(default)]
    vocabulary_focus: Vec<String>,
}

// Each variant must contain the entire object schema, including common fields.
// Flattening this enum into a parent would put properties/required beside oneOf,
// which Ollama's JSON-schema grammar converter does not reliably enforce.
#[derive(Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
enum GeneratedExercise {
    WordBankTranslation {
        #[serde(flatten)]
        common: GeneratedCommon,
        data: GeneratedWordBank,
    },
    MatchPairs {
        #[serde(flatten)]
        common: GeneratedCommon,
        data: GeneratedMatches,
    },
    FillBlank {
        #[serde(flatten)]
        common: GeneratedCommon,
        data: GeneratedChoice,
    },
    VocabularyChoice {
        #[serde(flatten)]
        common: GeneratedCommon,
        data: GeneratedChoice,
    },
}

#[derive(Deserialize, JsonSchema)]
struct GeneratedWordBank {
    tiles: Vec<LocalizedText>,
    joiner: String,
    /// Zero-based indices into tiles, never text or IDs.
    accepted_orders: Vec<Vec<usize>>,
    solution: LocalizedText,
}

#[derive(Deserialize, JsonSchema)]
struct GeneratedChoice {
    options: Vec<LocalizedText>,
    /// Zero-based index into options.
    correct_option: usize,
    solution: LocalizedText,
}

#[derive(Deserialize, JsonSchema)]
struct GeneratedMatches {
    pairs: Vec<GeneratedPair>,
}

#[derive(Deserialize, JsonSchema)]
struct GeneratedPair {
    source: LocalizedText,
    target: LocalizedText,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidOutput(message.into())
}

fn tiles(values: Vec<LocalizedText>) -> Result<Vec<Tile>, Error> {
    if values.is_empty() || values.iter().any(|value| value.text.trim().is_empty()) {
        return Err(invalid("Tiles/options must contain non-empty text"));
    }
    Ok(values
        .into_iter()
        .enumerate()
        .map(|(index, text)| Tile {
            id: format!("t{index}"),
            text: text.text,
            romanization: text.romanization,
        })
        .collect())
}

impl GeneratedChoice {
    fn into_data(self) -> Result<ChoiceData, Error> {
        let options = tiles(self.options)?;
        let correct = options
            .get(self.correct_option)
            .ok_or_else(|| invalid("correct_option must be a zero-based index into options"))?;
        if self.solution.text.trim().is_empty() {
            return Err(invalid("solution.text must not be empty"));
        }
        Ok(ChoiceData {
            correct_option_id: correct.id.clone(),
            options,
            solution: self.solution,
        })
    }
}

impl GeneratedExercise {
    fn into_exercise(self) -> Result<Exercise, Error> {
        let (common, kind) = match self {
            Self::WordBankTranslation { common, data } => {
                let tiles = tiles(data.tiles)?;
                if data.solution.text.trim().is_empty() || data.accepted_orders.is_empty() {
                    return Err(invalid(
                        "Word banks need a solution and at least one accepted order",
                    ));
                }
                let mut orders = Vec::new();
                for order in data.accepted_orders {
                    if order.is_empty() || order.iter().collect::<HashSet<_>>().len() != order.len()
                    {
                        return Err(invalid(
                            "Accepted orders must be non-empty and cannot repeat an index",
                        ));
                    }
                    orders.push(
                        order
                            .into_iter()
                            .map(|index| {
                                tiles.get(index).map(|tile| tile.id.clone()).ok_or_else(|| {
                                    invalid(
                                        "accepted_orders must use zero-based indices into tiles",
                                    )
                                })
                            })
                            .collect::<Result<Vec<_>, _>>()?,
                    );
                }
                (
                    common,
                    ExerciseKind::WordBankTranslation {
                        data: WordBankData {
                            tiles,
                            joiner: data.joiner,
                            accepted_orders: orders,
                            solution: data.solution,
                        },
                    },
                )
            }
            Self::FillBlank { common, data } => (
                common,
                ExerciseKind::FillBlank {
                    data: data.into_data()?,
                },
            ),
            Self::VocabularyChoice { common, data } => (
                common,
                ExerciseKind::VocabularyChoice {
                    data: data.into_data()?,
                },
            ),
            Self::MatchPairs { common, data } => {
                if data.pairs.is_empty()
                    || data.pairs.iter().any(|pair| {
                        pair.source.text.trim().is_empty() || pair.target.text.trim().is_empty()
                    })
                {
                    return Err(invalid(
                        "Matching pairs need non-empty source and target text",
                    ));
                }
                (
                    common,
                    ExerciseKind::MatchPairs {
                        data: MatchPairsData {
                            pairs: data
                                .pairs
                                .into_iter()
                                .enumerate()
                                .map(|(index, pair)| MatchingPair {
                                    id: format!("p{index}"),
                                    source: pair.source,
                                    target: pair.target,
                                })
                                .collect(),
                        },
                    },
                )
            }
        };
        if common.instruction.trim().is_empty() || common.explanation.trim().is_empty() {
            return Err(invalid("Instructions and explanations must not be empty"));
        }
        if !matches!(kind, ExerciseKind::MatchPairs { .. })
            && common
                .prompt
                .as_ref()
                .is_none_or(|prompt| prompt.text.trim().is_empty())
        {
            return Err(invalid(
                "Translation and choice exercises must include a non-empty prompt.text",
            ));
        }
        Ok(Exercise {
            id: uuid::Uuid::now_v7().to_string(),
            kind,
            direction: common.direction,
            instruction: common.instruction,
            prompt: common.prompt,
            hint: common.hint,
            explanation: common.explanation,
            grammar_focus: common.grammar_focus,
            vocabulary_focus: common.vocabulary_focus,
        })
    }
}

impl GeneratedLesson {
    fn into_lesson(self, input: &LessonInput) -> Result<Lesson, Error> {
        input.validate().map_err(Error::InvalidInput)?;
        if self.exercises.len() != usize::from(input.number_of_exercises) {
            return Err(invalid(format!(
                "Expected exactly {} exercises, received {}",
                input.number_of_exercises,
                self.exercises.len()
            )));
        }
        let learning_level = match input.learning_level {
            InputLevel::Cefr(level) => level,
            InputLevel::Numeric(n) => [
                CefrLevel::A1,
                CefrLevel::A2,
                CefrLevel::B1,
                CefrLevel::B2,
                CefrLevel::C1,
                CefrLevel::C2,
            ][usize::from(n - 1)],
        };
        Ok(Lesson {
            source_language: input.source_language,
            learning_language: input.learning_language,
            learning_level,
            include_romanization: input.include_romanization,
            total_exercises: self.exercises.len(),
            exercises: self
                .exercises
                .into_iter()
                .map(GeneratedExercise::into_exercise)
                .collect::<Result<_, _>>()?,
        })
    }
}

/// Produces lessons for a supported language pair using a completion model.
#[derive(Clone)]
pub struct Generator {
    agent: Arc<Agent>,
}

impl Generator {
    pub fn new(
        model: impl Into<DynModel<Completion>>,
        native_language: Language,
        learning_language: Language,
    ) -> Result<Self, Error> {
        let prompt = Language::system_prompt(native_language, learning_language)
            .ok_or(Error::UnsupportedLanguagePair)?;
        let agent = AgentBuilder::new(model)
            .preamble(prompt)
            .temperature(0.2)
            .build();
        Ok(Self {
            agent: Arc::new(agent),
        })
    }

    pub async fn generate(&self, input: &LessonInput) -> Result<Lesson, Error> {
        input.validate().map_err(Error::InvalidInput)?;
        let request = serde_json::to_string(input).map_err(Error::SerializeError)?;
        let mut prompt = request.clone();
        // One bounded repair attempt for malformed content; transport/auth failures propagate.
        for attempt in 0..2 {
            match self.agent.prompt_typed::<GeneratedLesson>(&prompt).await {
                Ok(response) => match response.output.into_lesson(input) {
                    Ok(lesson) => return Ok(lesson),
                    Err(error) if attempt == 0 => {
                        prompt = format!(
                            "{request}\nGenerate a complete replacement. The previous response failed validation: {error}. Follow the schema exactly. Answer indices start at zero and must reference existing tiles/options."
                        );
                    }
                    Err(error) => return Err(error),
                },
                Err(rig_agent::completion::StructuredOutputError::Deserialization {
                    error,
                    ..
                }) if attempt == 0 => {
                    prompt = format!(
                        "{request}\nGenerate a complete replacement. The previous JSON did not match the schema: {error}. Return only the requested JSON object with all required fields. Do not generate IDs; use zero-based answer indices as specified."
                    );
                }
                Err(error) => return Err(Error::ModelGenerationError(Box::new(error))),
            }
        }
        unreachable!("Both generation attempts return a result")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> Value {
        let common = json!({
            "direction": "source_to_target", "instruction": "Choose the translation",
            "prompt": {"text": "water"}, "hint": "Something to drink", "explanation": "물 means water."
        });
        let mut exercises = Vec::new();
        for (kind, data) in [
            (
                "vocabulary_choice",
                json!({"options": [{"text":"물"},{"text":"책"}], "correct_option":0, "solution":{"text":"물"}}),
            ),
            (
                "fill_blank",
                json!({"options": [{"text":"물"},{"text":"책"}], "correct_option":1, "solution":{"text":"책"}}),
            ),
            (
                "word_bank_translation",
                json!({"tiles": [{"text":"저는"},{"text":"학생이에요."}], "joiner":" ", "accepted_orders":[[0,1]], "solution":{"text":"저는 학생이에요."}}),
            ),
            (
                "match_pairs",
                json!({"pairs": [{"source":{"text":"water"},"target":{"text":"물"}}, {"source":{"text":"book"},"target":{"text":"책"}}]}),
            ),
        ] {
            let mut exercise = common.clone();
            exercise["type"] = json!(kind);
            exercise["data"] = data;
            exercises.push(exercise);
        }
        json!({"exercises":exercises})
    }

    fn input() -> LessonInput {
        LessonInput::new(Language::English, Language::Korean, CefrLevel::A2, 4, false)
    }

    #[tokio::test]
    #[ignore = "Live test: requires explicit LINQUO_TEST_OLLAMA_BASE_URL and LINQUO_TEST_OLLAMA_MODEL"]
    async fn ollama_qwen_live_generation() {
        let base_url =
            std::env::var("LINQUO_TEST_OLLAMA_BASE_URL").expect("Set the approved test server URL");
        let model_name =
            std::env::var("LINQUO_TEST_OLLAMA_MODEL").expect("Set the approved test model");
        let model =
            crate::provider::connect_at(&format!("ollama:{model_name}"), None, Some(&base_url))
                .await
                .unwrap();
        let generator = Generator::new(model, Language::English, Language::Korean).unwrap();
        for (level, count, romanize) in [(CefrLevel::A1, 2, true), (CefrLevel::A2, 10, false)] {
            let request =
                LessonInput::new(Language::English, Language::Korean, level, count, romanize);
            let lesson = generator.generate(&request).await.unwrap();
            assert_eq!(lesson.learning_level, level);
            assert_eq!(lesson.total_exercises, usize::from(count));
            assert_eq!(lesson.include_romanization, romanize);
            for exercise in &lesson.exercises {
                assert!(!exercise.instruction.trim().is_empty());
                assert!(!exercise.explanation.trim().is_empty());
            }
            let stored = serde_json::to_string(&lesson).unwrap();
            assert!(serde_json::from_str::<Lesson>(&stored).is_ok());
            eprintln!(
                "Generated and validated {count} {level:?} exercises (romanization: {romanize})"
            );
        }
    }

    #[test]
    fn every_union_branch_contains_its_shared_required_fields() {
        let schema = serde_json::to_value(schemars::schema_for!(GeneratedLesson)).unwrap();
        let exercise = &schema["$defs"]["GeneratedExercise"];
        assert!(exercise.get("properties").is_none());
        let branches = exercise["oneOf"].as_array().unwrap();
        assert_eq!(branches.len(), 4);
        for branch in branches {
            let required = branch["required"].as_array().unwrap();
            for field in [
                "type",
                "data",
                "direction",
                "instruction",
                "hint",
                "explanation",
            ] {
                assert!(
                    required.contains(&json!(field)),
                    "Branch must require {field}"
                );
                assert!(
                    branch["properties"].get(field).is_some(),
                    "Branch must define {field}"
                );
            }
        }
    }

    #[test]
    fn missing_shared_fields_are_rejected_instead_of_silently_defaulted() {
        // The reproduced Ollama response contained only type/data. Keep strict
        // deserialization: the fix is in the schema, not invented metadata.
        for field in ["direction", "instruction", "hint", "explanation"] {
            let mut value = fixture();
            for exercise in value["exercises"].as_array_mut().unwrap() {
                exercise.as_object_mut().unwrap().remove(field);
            }
            assert!(serde_json::from_value::<GeneratedLesson>(value).is_err());
        }
    }

    #[test]
    fn questions_that_need_a_prompt_cannot_be_saved_without_one() {
        for prompt in [Value::Null, json!({ "text": " " })] {
            let mut value = fixture();
            value["exercises"][0]["prompt"] = prompt;
            assert!(
                serde_json::from_value::<GeneratedLesson>(value)
                    .unwrap()
                    .into_lesson(&input())
                    .is_err()
            );
        }
    }

    #[test]
    fn id_free_output_becomes_a_gradable_persistent_lesson() {
        let lesson = serde_json::from_value::<GeneratedLesson>(fixture())
            .unwrap()
            .into_lesson(&input())
            .unwrap();
        assert_eq!(lesson.learning_level, CefrLevel::A2);
        assert_eq!(lesson.total_exercises, 4);
        let ids: HashSet<_> = lesson.exercises.iter().map(|ex| &ex.id).collect();
        assert_eq!(ids.len(), 4);
        for id in ids {
            assert!(uuid::Uuid::parse_str(id).is_ok());
        }
        let ExerciseKind::FillBlank { data } = &lesson.exercises[1].kind else {
            panic!("Expected a fill blank");
        };
        assert_eq!(
            data.options
                .iter()
                .find(|tile| tile.id == data.correct_option_id)
                .unwrap()
                .text,
            "책"
        );
        let ExerciseKind::WordBankTranslation { data } = &lesson.exercises[2].kind else {
            panic!("Expected a word bank");
        };
        let answer = data.accepted_orders[0]
            .iter()
            .map(|id| {
                data.tiles
                    .iter()
                    .find(|tile| &tile.id == id)
                    .unwrap()
                    .text
                    .as_str()
            })
            .collect::<Vec<_>>()
            .join(&data.joiner);
        assert_eq!(answer, data.solution.text);
        let ExerciseKind::MatchPairs { data } = &lesson.exercises[3].kind else {
            panic!("Expected matching pairs");
        };
        assert_ne!(data.pairs[0].id, data.pairs[1].id);
        let stored = serde_json::to_string(&lesson).unwrap();
        assert!(serde_json::from_str::<Lesson>(&stored).is_ok());
    }

    #[test]
    fn generation_schema_never_requires_model_generated_ids() {
        let schema = serde_json::to_string(&schemars::schema_for!(GeneratedLesson)).unwrap();
        assert!(!schema.contains("\"id\""));
        assert!(schema.contains("correct_option"));
    }

    #[test]
    fn invalid_answer_indices_and_counts_are_rejected() {
        let mut value = fixture();
        value["exercises"][0]["data"]["correct_option"] = json!(8);
        assert!(
            serde_json::from_value::<GeneratedLesson>(value)
                .unwrap()
                .into_lesson(&input())
                .is_err()
        );
        let mut value = fixture();
        value["exercises"][2]["data"]["accepted_orders"] = json!([[0, 0]]);
        assert!(
            serde_json::from_value::<GeneratedLesson>(value)
                .unwrap()
                .into_lesson(&input())
                .is_err()
        );
        let mut request = input();
        request.number_of_exercises = 3;
        assert!(
            serde_json::from_value::<GeneratedLesson>(fixture())
                .unwrap()
                .into_lesson(&request)
                .is_err()
        );
    }
}
