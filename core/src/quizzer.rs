use crate::generation::CefrLevel;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Quizzer {
    frequency_map: HashMap<CefrLevel, i64>,
}

impl Quizzer {
    pub fn new() -> Self {
        Self::default()
    }

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

    pub fn insert_correct(&mut self, level: CefrLevel) {
        *self.frequency_map.entry(level).or_insert(0) += 1;
    }

    pub fn insert_incorrect(&mut self, level: CefrLevel) {
        *self.frequency_map.entry(level).or_insert(0) -= 1;
    }
}
