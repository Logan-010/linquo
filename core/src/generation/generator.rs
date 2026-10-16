use super::{Error, Language, Lesson, LessonInput};
use rig::{
    DynModel,
    agent::{Agent, AgentBuilder},
    operation::Completion,
};
use std::sync::Arc;

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
        let response = self
            .agent
            .prompt_typed::<Lesson>(serde_json::to_string(input).map_err(Error::SerializeError)?)
            .await
            .map_err(Box::new)?;

        Ok(response.output)
    }
}
