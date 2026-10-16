//! Adaptive CEFR level tracking based on per-level exercise results.
//!
//! Feed in correct and incorrect answers via [`Quizzer::insert_correct`]
//! and [`Quizzer::insert_incorrect`], then read the user's current
//! estimated [`CefrLevel`] with [`Quizzer::level`]. The struct is
//! `Serialize`/`Deserialize` so it can be persisted in the database.

use crate::generation::CefrLevel;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tracks a learner's adaptive CEFR level based on their exercise results.
///
/// Maintains a running score per CEFR level (correct answers add, incorrect
/// answers subtract) and derives a current level estimate from those scores.
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Quizzer {
    frequency_map: HashMap<CefrLevel, i64>,
}

impl Quizzer {
    /// Create a new quizzer with no recorded results.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the learner's current estimated CEFR level.
    pub fn level(&self) -> CefrLevel {
        use CefrLevel::*;

        let levels = [A1, A2, B1, B2, C1, C2];
        let mut current = 0;

        for _ in 0..levels.len() {
            let score = self
                .frequency_map
                .get(&levels[current])
                .copied()
                .unwrap_or(0);

            if score >= 3 && current < levels.len() - 1 {
                current += 1;
            } else if score <= -2 && current > 0 {
                current -= 1;
            } else {
                break;
            }
        }

        levels[current]
    }

    /// Record a correct answer at the given level.
    pub fn insert_correct(&mut self, level: CefrLevel) {
        *self.frequency_map.entry(level).or_insert(0) += 1;
    }

    /// Record an incorrect answer at the given level.
    pub fn insert_incorrect(&mut self, level: CefrLevel) {
        *self.frequency_map.entry(level).or_insert(0) -= 1;
    }
}
