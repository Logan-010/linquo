//! Types shared by lesson generation and persistence.
//!
//! This defines the data model for a lesson ([`Lesson`], [`Exercise`], and
//! the various exercise kinds), the supported [`Language`]s and
//! [`CefrLevel`]s, plus input/output types used by the [`Generator`].

use rust_embed::Embed;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use thiserror::Error;

/// Errors that can occur while generating or validating a lesson.
#[derive(Error, Debug)]
pub enum Error {
    /// The requested language pair has no supported system prompt.
    #[error("Language pair not supported yet!")]
    UnsupportedLanguagePair,
    /// Failed to serialize a value to JSON.
    #[error(transparent)]
    SerializeError(serde_json::Error),
    /// The model did not produce a valid, structured lesson.
    #[error("Model failed to generate structured output: {0}")]
    ModelGenerationError(#[from] Box<rig::completion::StructuredOutputError>),
    /// The input is invalid
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    /// The model returned a lesson that cannot be graded safely.
    #[error("Generated lesson is invalid: {0}")]
    InvalidOutput(String),
}

/// A language supported by Linquo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum Language {
    /// English.
    English,
    /// Korean.
    Korean,
}

#[derive(Embed)]
#[folder = "prompts"]
struct Prompts;

const LANGUAGE_PAIRS: &[(Language, Language, &str)] = &[(
    Language::English,
    Language::Korean,
    "english_learning_korean.txt",
)];

impl Language {
    /// Supported native/learning pairs, shared with the frontend.
    pub fn supported_pairs() -> Vec<(Self, Self)> {
        LANGUAGE_PAIRS
            .iter()
            .map(|(source, target, _)| (*source, *target))
            .collect()
    }
    /// Return the system prompt for the given native/learning pair, or
    /// `None` if that pair is not supported yet.
    pub fn system_prompt(native: Language, learning: Language) -> Option<String> {
        let (_, _, file_path) = LANGUAGE_PAIRS
            .iter()
            .find(|(source, target, _)| *source == native && *target == learning)?;

        Some(
            Prompts::get(file_path)
                .and_then(|c| String::from_utf8(c.data.to_vec()).ok())
                .expect("Expected valid prompt"),
        )
    }
}

/// Parameters describing a lesson to generate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LessonInput {
    /// The source language the learner comes from.
    pub source_language: Language,
    /// The language being learned.
    pub learning_language: Language,
    /// The target proficiency level.
    pub learning_level: InputLevel,
    /// How many exercises to generate (must be 1-30).
    pub number_of_exercises: u8,
    /// Whether to include romanization for learning-language text.
    #[serde(default)]
    pub include_romanization: bool,
}

impl LessonInput {
    /// Create a new input with a CEFR-based level.
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

    /// Validate the input, returning a human-readable error message if any
    /// field is out of range or inconsistent.
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

/// The proficiency level requested for a lesson.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InputLevel {
    /// A CEFR level such as [`CefrLevel::A1`].
    Cefr(CefrLevel),
    /// A numeric level from 1 to 6.
    Numeric(u8),
}

/// A CEFR (Common European Framework of Reference) proficiency level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Hash)]
pub enum CefrLevel {
    /// Beginner.
    A1,
    /// Elementary.
    A2,
    /// Intermediate.
    B1,
    /// Upper-intermediate.
    B2,
    /// Advanced.
    C1,
    /// Proficient.
    C2,
}

/// A generated lesson of exercises for one language pair and level.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, FromRow)]
pub struct Lesson {
    /// The source language of the lesson.
    pub source_language: Language,
    /// The language being learned.
    pub learning_language: Language,
    /// The target CEFR level.
    pub learning_level: CefrLevel,
    /// Whether romanization is included in the text.
    pub include_romanization: bool,
    /// The total number of exercises in the lesson.
    pub total_exercises: usize,
    /// The exercises, in order.
    pub exercises: Vec<Exercise>,
}

/// A single exercise within a lesson.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, FromRow)]
pub struct Exercise {
    /// A stable identifier for the exercise.
    pub id: String,
    /// The type of exercise and its associated data.
    #[serde(flatten)]
    pub kind: ExerciseKind,
    /// The direction the exercise trains.
    pub direction: Direction,
    /// A short instruction shown to the learner.
    pub instruction: String,
    /// Optional localized prompt text.
    pub prompt: Option<LocalizedText>,
    /// A hint to help the learner.
    pub hint: String,
    /// An explanation of the correct answer.
    pub explanation: String,
    /// Grammar points this exercise focuses on.
    pub grammar_focus: Vec<String>,
    /// Vocabulary this exercise focuses on.
    pub vocabulary_focus: Vec<String>,
}

/// The kind of exercise, tagged by JSON `type`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExerciseKind {
    /// Build a sentence by choosing from a bank of word tiles.
    WordBankTranslation { data: WordBankData },
    /// Match source and target pairs.
    MatchPairs { data: MatchPairsData },
    /// Fill a blank with the correct choice.
    FillBlank { data: ChoiceData },
    /// Choose the correct vocabulary option.
    VocabularyChoice { data: ChoiceData },
}

/// The translation direction an exercise trains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// From the source language to the target language.
    SourceToTarget,
    /// From the target language back to the source language.
    TargetToSource,
    /// Entirely within the target language.
    WithinTarget,
    /// Both directions.
    Bidirectional,
}

/// Text with an optional romanization.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LocalizedText {
    /// The text in the target script.
    pub text: String,
    /// Optional romanization of the text.
    pub romanization: Option<String>,
}

/// A selectable tile (word or phrase) in a word bank or choice exercise.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Tile {
    /// A stable identifier for the tile.
    pub id: String,
    /// The tile text.
    pub text: String,
    /// Optional romanization of the tile text.
    pub romanization: Option<String>,
}

/// Data for a word-bank translation exercise.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WordBankData {
    /// The available word tiles.
    pub tiles: Vec<Tile>,
    /// The character used to join chosen tiles into an answer.
    pub joiner: String,
    /// All accepted orderings of tile ids.
    pub accepted_orders: Vec<Vec<String>>,
    /// The correct solution.
    pub solution: LocalizedText,
}

/// Data for a match-pairs exercise.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MatchPairsData {
    /// The pairs to match.
    pub pairs: Vec<MatchingPair>,
}

/// A single source/target pair in a match-pairs exercise.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MatchingPair {
    /// A stable identifier for the pair.
    pub id: String,
    /// The source text.
    pub source: LocalizedText,
    /// The target text.
    pub target: LocalizedText,
}

/// Data for a choice-based exercise (fill-in-the-blank or vocabulary).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ChoiceData {
    /// The selectable options.
    pub options: Vec<Tile>,
    /// The id of the correct option.
    pub correct_option_id: String,
    /// The correct solution.
    pub solution: LocalizedText,
}

/// An error response for a single exercise.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExerciseErrorResponse {
    /// The specific error.
    pub error: ExerciseError,
}

/// A code and message describing an exercise error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExerciseError {
    /// A stable machine-readable error code.
    pub code: String,
    /// A human-readable error message.
    pub message: String,
}

/// The result of a generation request: either a lesson or an error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GeneratorResponse {
    /// A successfully generated lesson.
    Success(Lesson),
    /// An error describing why generation failed.
    Error(ExerciseErrorResponse),
}
