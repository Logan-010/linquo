mod db;
mod generator;
mod score;
mod state;
mod util;

use linquo_core::db::Database;
use state::AppState;
use tauri::Manager;
use util::errstr;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let db = tauri::async_runtime::block_on(Database::new(
                app.path().local_data_dir()?.join("linquo.db"),
            ))?;

            app.manage(AppState::new(db));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::kv_get,
            db::kv_put,
            db::kv_rm,
            db::import_database,
            db::export_database,
            db::supported_language_pairs,
            db::fetch_excercises,
            db::fetch_lesson,
            generator::init_generation,
            generator::generate_lesson,
            score::load_score,
            score::save_score,
            score::correct,
            score::incorrect,
            score::score
        ])
        .run(tauri::generate_context!())
        .expect("Error while building tauri application");
}
