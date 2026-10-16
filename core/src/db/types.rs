use crate::{db::queries, generation::ExerciseOutput};
use sqlx::SqlitePool;
use std::{io, path::PathBuf};
use thiserror::Error;

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

    pub async fn insert_excercise(&self, excercise: &ExerciseOutput) -> Result<(), Error> {
        queries::insert_lesson(&self.pool, excercise).await?;

        Ok(())
    }
}
