use crate::{
    db::queries,
    generation::{CefrLevel, Exercise, Language, Lesson},
};
use sqlx::SqlitePool;
use std::{io, path::PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("SQL error: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("SQL migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error(transparent)]
    SerializeError(#[from] serde_json::Error),
}

pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn new(path: PathBuf) -> Result<Self, Error> {
        let pool = super::connect(path).await?;

        Ok(Self { pool })
    }

    pub async fn insert_lesson(&self, excercise: &Lesson) -> Result<(), Error> {
        queries::insert_lesson(&self.pool, excercise).await?;

        Ok(())
    }

    pub async fn fetch_exercises(
        &self,
        n: u32,
        level: CefrLevel,
        source: Language,
        learning: Language,
    ) -> Result<Vec<Exercise>, Error> {
        queries::fetch_exercises(&self.pool, source, learning, level, n).await
    }

    pub async fn fetch_lesson(
        &self,
        level: CefrLevel,
        source: Language,
        learning: Language,
    ) -> Result<Option<Lesson>, Error> {
        queries::fetch_lesson(&self.pool, source, learning, level).await
    }

    pub async fn fetch_lesson_id(&self, id: Uuid) -> Result<Option<Lesson>, Error> {
        queries::fetch_lesson_id(&self.pool, id).await
    }
}
