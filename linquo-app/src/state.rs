use linquo_core::db::Database;

pub struct AppState {
    pub db: Database,
}

impl AppState {
    pub fn new(db: Database) -> Self {
        Self { db }
    }
}
