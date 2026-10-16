use crate::state::AppState;
use linquo_core::{
    generation::{Generator, InputLevel, Language, Lesson, LessonInput},
    provider,
};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn init_generation(
    app: AppHandle,
    provider: String,
    credentials: Option<String>,
    base_url: Option<String>,
    source: Language,
    target: Language,
) -> Result<(), String> {
    let model = provider::connect_at(&provider, credentials.as_deref(), base_url.as_deref())
        .await
        .map_err(crate::errstr)?;

    let generator = Generator::new(model, source, target).map_err(crate::errstr)?;

    *app.state::<AppState>().generator.lock().await = Some(generator);

    Ok(())
}

#[tauri::command]
pub async fn generate_lesson(
    app: AppHandle,
    source: Language,
    target: Language,
    n: u8,
    romanize: bool,
    level: InputLevel,
) -> Result<Lesson, String> {
    let state = app.state::<AppState>();

    let lesson = state
        .generator
        .lock()
        .await
        .as_ref()
        .ok_or_else(|| String::from("Generation not initialized"))?
        .generate(&LessonInput {
            source_language: source,
            learning_language: target,
            number_of_exercises: n,
            include_romanization: romanize,
            learning_level: level,
        })
        .await
        .map_err(crate::errstr)?;

    state
        .db
        .insert_lesson(&lesson)
        .await
        .map_err(crate::errstr)?;

    Ok(lesson)
}
