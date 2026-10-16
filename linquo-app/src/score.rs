use crate::state::AppState;
use linquo_core::{
    generation::{CefrLevel, Language},
    quizzer::Quizzer,
};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn load_score(
    app: AppHandle,
    source: Language,
    target: Language,
    quiz: bool,
) -> Result<CefrLevel, String> {
    let state = app.state::<AppState>();

    if quiz {
        let quizzer = Quizzer::with_weight(3);
        *state.score.lock().await = Some(quizzer);
        Ok(CefrLevel::A1)
    } else {
        let key = format!("score-{:?}-{:?}", source, target);

        let qzj = state.db.get(&key).await.map_err(crate::errstr)?;

        let quizzer = if let Some(json) = qzj {
            serde_json::from_str(&json).map_err(crate::errstr)?
        } else {
            let q = Quizzer::with_weight(3);
            let json = serde_json::to_string(&q).map_err(crate::errstr)?;
            state.db.insert(&key, &json).await.map_err(crate::errstr)?;
            q
        };

        let score = quizzer.level();

        *state.score.lock().await = Some(quizzer);
        *state.score_key.lock().await = Some(key);

        Ok(score)
    }
}

#[tauri::command]
pub async fn save_score(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if let Some(ref score) = *state.score.lock().await
        && let Some(ref key) = *state.score_key.lock().await
    {
        let qjs = serde_json::to_string(score).map_err(crate::errstr)?;

        state.db.insert(key, &qjs).await.map_err(crate::errstr)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn correct(app: AppHandle, level: CefrLevel) {
    if let Some(ref mut score) = *app.state::<AppState>().score.lock().await {
        score.insert_correct(level);
    }
}

#[tauri::command]
pub async fn incorrect(app: AppHandle, level: CefrLevel) {
    if let Some(ref mut score) = *app.state::<AppState>().score.lock().await {
        score.insert_incorrect(level);
    }
}

#[tauri::command]
pub async fn score(app: AppHandle) -> Option<CefrLevel> {
    app.state::<AppState>()
        .score
        .lock()
        .await
        .as_ref()
        .map(|f| f.level())
}
