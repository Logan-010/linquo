//! The [`Generator`] produces lessons from a completion model for a
//! supported language pair.

use super::{Error, Language, Lesson, LessonInput};
use rig::{
    DynModel,
    agent::{Agent, AgentBuilder},
    operation::Completion,
};
use std::sync::Arc;

/// Generates language learning lessons using a rig completion model.
///
/// A generator is bound to a specific source and learning language pair and
/// is cheap to clone. Create one with [`Generator::new`], then call
/// [`Generator::generate`] to produce a [`Lesson`].
#[derive(Clone)]
pub struct Generator {
    agent: Arc<Agent>,
}

impl Generator {
    /// Create a new generator for the given language pair.
    ///
    /// `native_language` is the learner's source language and
    /// `learning_language` is the language being learned. Returns
    /// [`Error::UnsupportedLanguagePair`] if no system prompt exists for the
    /// pair.
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

    /// Generate a lesson for the given input.
    ///
    /// The model produces a typed [`Lesson`] matching the requested
    /// [`Language`], level, and number of exercises described by `input`.
    pub async fn generate(&self, input: &LessonInput) -> Result<Lesson, Error> {
        input.validate().map_err(Error::InvalidInput)?;

        let response = self
            .agent
            .prompt_typed::<Lesson>(serde_json::to_string(input).map_err(Error::SerializeError)?)
            .await
            .map_err(Box::new)?;

        let mut lesson = response.output;
        // Model-generated identifiers are only unique within one response (e.g. E001).
        // Persist globally unique IDs so subsequent lessons can coexist in the library.
        for exercise in &mut lesson.exercises {
            exercise.id = uuid::Uuid::now_v7().to_string();
        }
        Ok(lesson)
    }
}
