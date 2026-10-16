use crate::state::AppState;
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
