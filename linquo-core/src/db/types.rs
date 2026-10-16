//! Persistent storage types for lessons and key-value settings.

use crate::{
    db::queries,
    generation::{CefrLevel, Exercise, Language, Lesson},
};
use sqlx::SqlitePool;
use std::{io, path::PathBuf};
use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur when accessing the database.
#[derive(Error, Debug)]
pub enum Error {
    /// An I/O error, e.g. creating the database file or its directory.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    /// A SQL error from a query or connection.
    #[error("SQL error: {0}")]
    Sql(#[from] sqlx::Error),
    /// A schema migration failed to run.
    #[error("SQL migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    /// Failed to serialize a value to JSON.
    #[error(transparent)]
    SerializeError(#[from] serde_json::Error),
}

/// A handle to a Linquo SQLite database.
///
/// Create with [`Database::new`], which connects (with a single-connection
/// pool), runs any pending migrations, and exposes methods for lessons and a
/// simple key-value store.
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Atomically replace all application data with a validated SQLite snapshot.
    pub async fn import(&self, path: &std::path::Path) -> Result<(), Error> {
        let mut connection = self.pool.acquire().await?;
        sqlx::query("ATTACH DATABASE ? AS imported")
            .bind(path.to_string_lossy().as_ref())
            .execute(&mut *connection)
            .await?;
        let result = async {
            let integrity: String = sqlx::query_scalar("PRAGMA imported.integrity_check")
                .fetch_one(&mut *connection)
                .await?;
            if integrity != "ok" {
                return Err(Error::Io(io::Error::new(
                    io::ErrorKind::InvalidData,
                    integrity,
                )));
            }
            use sqlx::Acquire;
            let mut tx = connection.begin().await?;
            sqlx::query("DELETE FROM exercises")
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM lessons").execute(&mut *tx).await?;
            sqlx::query("DELETE FROM key_value_store")
                .execute(&mut *tx)
                .await?;
            for statement in [
                "INSERT INTO main.key_value_store SELECT * FROM imported.key_value_store",
                "INSERT INTO main.lessons SELECT * FROM imported.lessons",
                "INSERT INTO main.exercises SELECT * FROM imported.exercises",
            ] {
                sqlx::query(statement).execute(&mut *tx).await?;
            }
            tx.commit().await?;
            Ok(())
        }
        .await;
        sqlx::query("DETACH DATABASE imported")
            .execute(&mut *connection)
            .await?;
        result
    }

    /// Open (or create) a database at the given path and run migrations.
    pub async fn new(path: PathBuf) -> Result<Self, Error> {
        let pool = super::connect(path).await?;

        Ok(Self { pool })
    }

    /// Get a stored value, returning `None` if the key does not exist.
    pub async fn get(&self, key: &str) -> Result<Option<String>, Error> {
        queries::get_value(&self.pool, key).await
    }

    /// Insert a value, replacing any existing value for the key.
    pub async fn insert(&self, key: &str, value: &str) -> Result<(), Error> {
        queries::insert_value(&self.pool, key, value).await
    }

    /// Remove a key, succeeding even if it does not exist.
    pub async fn remove(&self, key: &str) -> Result<(), Error> {
        queries::remove_value(&self.pool, key).await
    }

    /// Store a lesson and its exercises, returning `()` on success.
    pub async fn insert_lesson(&self, excercise: &Lesson) -> Result<(), Error> {
        queries::insert_lesson(&self.pool, excercise).await?;

        Ok(())
    }

    /// Fetch up to `n` exercises matching the given languages and level.
    pub async fn fetch_exercises(
        &self,
        n: u32,
        level: CefrLevel,
        source: Language,
        learning: Language,
    ) -> Result<Vec<Exercise>, Error> {
        queries::fetch_exercises(&self.pool, source, learning, level, n).await
    }

    /// Fetch a random lesson matching the given languages and level, or
    /// `None` if no lesson exists.
    pub async fn fetch_lesson(
        &self,
        level: CefrLevel,
        source: Language,
        learning: Language,
    ) -> Result<Option<Lesson>, Error> {
        queries::fetch_lesson(&self.pool, source, learning, level).await
    }

    /// Fetch a lesson by its identifier, or `None` if it does not exist.
    pub async fn fetch_lesson_id(&self, id: Uuid) -> Result<Option<Lesson>, Error> {
        queries::fetch_lesson_id(&self.pool, id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn database_import_replaces_data_and_rolls_back_invalid_snapshots() {
        let target_path = std::env::temp_dir().join(format!("linquo-target-{}.db", Uuid::now_v7()));
        let database = Database::new(target_path.clone()).await.unwrap();
        database.insert("old-setting", "old").await.unwrap();

        let source_path = std::env::temp_dir().join(format!("linquo-import-{}.db", Uuid::now_v7()));
        let source = Database::new(source_path.clone()).await.unwrap();
        source.insert("provider", "ollama:llama3.2").await.unwrap();
        source
            .insert("score-English-Korean", "saved-score")
            .await
            .unwrap();
        sqlx::query("INSERT INTO lessons (id, source_language, learning_language, learning_level, total_exercises) VALUES ('lesson', 'English', 'Korean', 'A1', 1)")
            .execute(&source.pool).await.unwrap();
        sqlx::query("INSERT INTO exercises (id, lesson_id, kind, direction, instruction, hint, explanation) VALUES ('exercise', 'lesson', '{}', 'source_to_target', 'Translate', 'Hint', 'Explanation')")
            .execute(&source.pool).await.unwrap();
        source.pool.close().await;

        database.import(&source_path).await.unwrap();
        assert_eq!(database.get("old-setting").await.unwrap(), None);
        assert_eq!(
            database.get("provider").await.unwrap().as_deref(),
            Some("ollama:llama3.2")
        );
        assert_eq!(
            database
                .get("score-English-Korean")
                .await
                .unwrap()
                .as_deref(),
            Some("saved-score")
        );
        let exercises: i64 = sqlx::query_scalar("SELECT count(*) FROM exercises")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(exercises, 1);

        // A valid SQLite file with incomplete Linquo tables must not erase existing data.
        let invalid_path =
            std::env::temp_dir().join(format!("linquo-invalid-{}.db", Uuid::now_v7()));
        let invalid = super::super::connect::connect(&invalid_path).await.unwrap();
        sqlx::query("DROP TABLE exercises")
            .execute(&invalid)
            .await
            .unwrap();
        invalid.close().await;
        assert!(database.import(&invalid_path).await.is_err());
        assert_eq!(
            database.get("provider").await.unwrap().as_deref(),
            Some("ollama:llama3.2")
        );
        let exercises: i64 = sqlx::query_scalar("SELECT count(*) FROM exercises")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(exercises, 1);
        // The failed attachment is cleaned up, so a subsequent import succeeds.
        database.import(&source_path).await.unwrap();
        database.pool.close().await;
        std::fs::remove_file(source_path).unwrap();
        std::fs::remove_file(invalid_path).unwrap();
        std::fs::remove_file(target_path).unwrap();
    }

    #[tokio::test]
    async fn key_values_can_be_inserted_updated_and_removed() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let database = Database { pool };

        assert_eq!(database.get("language").await.unwrap(), None);
        database.remove("language").await.unwrap();

        database.insert("language", "Korean").await.unwrap();
        database.insert("other", "untouched").await.unwrap();
        assert_eq!(
            database.get("language").await.unwrap().as_deref(),
            Some("Korean")
        );

        database.insert("language", "English").await.unwrap();
        assert_eq!(
            database.get("language").await.unwrap().as_deref(),
            Some("English")
        );

        database.remove("language").await.unwrap();
        assert_eq!(database.get("language").await.unwrap(), None);
        assert_eq!(
            database.get("other").await.unwrap().as_deref(),
            Some("untouched")
        );

        database.insert("empty", "").await.unwrap();
        assert_eq!(database.get("empty").await.unwrap().as_deref(), Some(""));
    }
}
