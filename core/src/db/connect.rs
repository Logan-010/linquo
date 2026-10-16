use super::Error;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::path::Path;
use tokio::fs;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect<P: AsRef<Path>>(path: P) -> Result<SqlitePool, Error> {
    if let Some(p) = path.as_ref().parent()
        && !fs::try_exists(p).await?
    {
        fs::create_dir_all(p).await?;
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;

    MIGRATOR.run(&pool).await?;

    Ok(pool)
}
