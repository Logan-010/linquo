use crate::state::AppState;
use linquo_core::generation::{CefrLevel, Exercise, Language, Lesson};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn supported_language_pairs() -> Vec<(Language, Language)> {
    Language::supported_pairs()
}

#[tauri::command]
pub async fn export_database(app: AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(crate::errstr)?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(crate::errstr)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(crate::errstr)?
        .as_nanos();
    let path = directory.join(format!("linquo-{timestamp}.db"));
    if let Err(error) = app.state::<AppState>().db.export(&path).await {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(crate::errstr(error));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn import_database(app: AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > 100 * 1024 * 1024 || !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Choose a Linquo SQLite database smaller than 100 MB.".into());
    }
    let state = app.state::<AppState>();
    // Hold all session locks so an import cannot race an in-flight lesson or score update.
    let mut generator = state.generator.lock().await;
    let mut score = state.score.lock().await;
    let mut score_key = state.score_key.lock().await;
    let path = app
        .path()
        .app_cache_dir()
        .map_err(crate::errstr)?
        .join("import.db");
    tokio::fs::create_dir_all(path.parent().unwrap())
        .await
        .map_err(crate::errstr)?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(crate::errstr)?;
    let result = state.db.import(&path).await.map_err(crate::errstr);
    let _ = tokio::fs::remove_file(path).await;
    result?;
    *generator = None;
    *score = None;
    *score_key = None;
    Ok(())
}

#[tauri::command]
pub async fn kv_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    app.state::<AppState>()
        .db
        .get(&key)
        .await
        .map_err(crate::errstr)
}

#[tauri::command]
pub async fn kv_put(app: AppHandle, key: String, value: String) -> Result<(), String> {
    app.state::<AppState>()
        .db
        .insert(&key, &value)
        .await
        .map_err(crate::errstr)?;

    Ok(())
}

#[tauri::command]
pub async fn kv_rm(app: AppHandle, key: String) -> Result<(), String> {
    app.state::<AppState>()
        .db
        .remove(&key)
        .await
        .map_err(crate::errstr)?;

    Ok(())
}

#[tauri::command]
pub async fn fetch_excercises(
    app: AppHandle,
    n: u32,
    source: Language,
    target: Language,
    level: CefrLevel,
) -> Result<Vec<Exercise>, String> {
    app.state::<AppState>()
        .db
        .fetch_exercises(n, level, source, target)
        .await
        .map_err(crate::errstr)
}

#[tauri::command]
pub async fn fetch_lesson(
    app: AppHandle,
    level: CefrLevel,
    source: Language,
    target: Language,
) -> Result<Option<Lesson>, String> {
    app.state::<AppState>()
        .db
        .fetch_lesson(level, source, target)
        .await
        .map_err(crate::errstr)
}
