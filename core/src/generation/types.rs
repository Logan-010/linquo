use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Language pair not supported yet!")]
    UnsupportedLanguagePair,
    #[error(transparent)]
    SerializeError(serde_json::Error),
    #[error("Model failed to generate structured output: {0}")]
    ModelGenerationError(#[from] Box<rig::completion::StructuredOutputError>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum Language {
    English,
    Korean,
}

impl Language {
    pub fn system_prompt(native: Language, learning: Language) -> Option<&'static str> {
        match (native, learning) {
            (Language::English, Language::Korean) => {
                Some(include_str!("../../prompts/english_learning_korean.txt"))
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExerciseInput {
    pub source_language: Language,
    pub learning_language: Language,
    pub learning_level: InputLevel,
    pub number_of_exercises: u8,

    #[serde(default)]
    pub include_romanization: bool,
}

impl ExerciseInput {
    pub fn new(
        source_language: Language,
        learning_language: Language,
        learning_level: CefrLevel,
        number_of_exercises: u8,
        include_romanization: bool,
    ) -> Self {
        Self {
            source_language,
            learning_language,
            learning_level: InputLevel::Cefr(learning_level),
            number_of_exercises,
            include_romanization,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.source_language == self.learning_language {
            return Err("Source and learning languages must differ".into());
        }

        if !(1..=30).contains(&self.number_of_exercises) {
            return Err("Number of exercises must be between 1 and 30".into());
        }

        if let InputLevel::Numeric(level) = self.learning_level
            && !(1..=6).contains(&level)
        {
            return Err("Numeric level must be 1 through 6".into());
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InputLevel {
    Cefr(CefrLevel),
    Numeric(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum CefrLevel {
    A1,
    A2,
    B1,
    B2,
    C1,
    C2,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, FromRow)]
pub struct ExerciseOutput {
    pub source_language: Language,
    pub learning_language: Language,
    pub learning_level: CefrLevel,
    pub include_romanization: bool,
    pub total_exercises: usize,
    pub exercises: Vec<Exercise>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, FromRow)]
pub struct Exercise {
    pub id: String,
    #[serde(flatten)]
    pub kind: ExerciseKind,
    pub direction: Direction,
    pub instruction: String,
    pub prompt: Option<LocalizedText>,
    pub hint: String,
    pub explanation: String,
    pub grammar_focus: Vec<String>,
    pub vocabulary_focus: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExerciseKind {
    WordBankTranslation { data: WordBankData },
    MatchPairs { data: MatchPairsData },
    FillBlank { data: ChoiceData },
    VocabularyChoice { data: ChoiceData },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    SourceToTarget,
    TargetToSource,
    WithinTarget,
    Bidirectional,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LocalizedText {
    pub text: String,
    pub romanization: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Tile {
    pub id: String,
    pub text: String,
    pub romanization: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WordBankData {
    pub tiles: Vec<Tile>,
    pub joiner: String,
    pub accepted_orders: Vec<Vec<String>>,
    pub solution: LocalizedText,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MatchPairsData {
    pub pairs: Vec<MatchingPair>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MatchingPair {
    pub id: String,
    pub source: LocalizedText,
    pub target: LocalizedText,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ChoiceData {
    pub options: Vec<Tile>,
    pub correct_option_id: String,
    pub solution: LocalizedText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExerciseErrorResponse {
    pub error: ExerciseError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExerciseError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GeneratorResponse {
    Success(ExerciseOutput),
    Error(ExerciseErrorResponse),
}
