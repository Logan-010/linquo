//! The core library for Linquo, an AI-powered language learning app.
//!
//! This crate provides the public API for generating, persisting, and
//! retrieving language learning lessons, along with adaptive CEFR level
//! tracking and LLM provider connection helpers.
//!
//! # Modules
//!
//! - [`generation`] — AI-based lesson generation: [`generation::Generator`],
//!   lesson/exercise types, and CEFR levels.
//! - [`db`] — SQLite-backed persistence for lessons and key-value settings.
//! - [`quizzer`] — Adaptive CEFR level tracking based on exercise results.
//! - [`provider`] — Connect to a rig LLM provider for generation.

pub mod db;
pub mod generation;
pub mod provider;
pub mod quizzer;
