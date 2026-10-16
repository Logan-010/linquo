use crate::state::AppState;
use linquo_core::generation::{CefrLevel, Exercise, Language, Lesson};
use tauri::{AppHandle, Manager};

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
