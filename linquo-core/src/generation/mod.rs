//! AI-based lesson generation backed by an LLM.
//!
//! Use [`Generator::new`] to create a generator for a supported language
//! pair, then call [`Generator::generate`] with a [`LessonInput`] to
//! produce a [`Lesson`].

mod types;
pub use types::*;

mod generator;
pub use generator::Generator;
