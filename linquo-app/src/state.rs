use linquo_core::{db::Database, generation::Generator, quizzer::Quizzer};
use tauri::async_runtime::Mutex;

pub struct AppState {
    pub db: Database,
    pub generator: Mutex<Option<Generator>>,
    pub score_key: Mutex<Option<String>>,
    pub score: Mutex<Option<Quizzer>>,
}

impl AppState {
    pub fn new(db: Database) -> Self {
        Self {
            db,
            generator: Mutex::new(None),
            score_key: Mutex::new(None),
            score: Mutex::new(None),
        }
    }
}
