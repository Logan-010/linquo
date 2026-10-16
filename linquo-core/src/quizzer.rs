//! Adaptive CEFR level tracking based on per-level exercise results.
//!
//! Feed in correct and incorrect answers via [`Quizzer::insert_correct`]
//! and [`Quizzer::insert_incorrect`], then read the user's current
//! estimated [`CefrLevel`] with [`Quizzer::level`]. The struct is
//! `Serialize`/`Deserialize` so it can be persisted in the database.

use crate::generation::CefrLevel;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_weight() -> i64 {
    1
}

/// Tracks a learner's adaptive CEFR level.
///
/// Weight controls how strongly each answer affects the score.
/// Higher weights allow faster proficiency adjustments.
#[derive(Serialize, Deserialize, Debug)]
pub struct Quizzer {
    frequency_map: HashMap<CefrLevel, i64>,

    #[serde(default = "default_weight")]
    weight: i64,
}

impl Default for Quizzer {
    fn default() -> Self {
        Self {
            frequency_map: HashMap::new(),
            weight: 1,
        }
    }
}

impl Quizzer {
    /// Create a quizzer with the default weight of 1.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a quizzer with a custom weight.
    pub fn with_weight(weight: i64) -> Self {
        Self {
            weight: weight.max(1),
            ..Self::default()
        }
    }

    /// Change the weight for future answers.
    pub fn set_weight(&mut self, weight: i64) {
        self.weight = weight.max(1);
    }

    /// Get the current weight.
    pub fn weight(&self) -> i64 {
        self.weight
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
        let score = self.frequency_map.entry(level).or_insert(0);
        *score = score.saturating_add(self.weight.max(1));
    }

    /// Record an incorrect answer at the given level.
    pub fn insert_incorrect(&mut self, level: CefrLevel) {
        let score = self.frequency_map.entry(level).or_insert(0);
        *score = score.saturating_sub(self.weight.max(1));
    }
}
