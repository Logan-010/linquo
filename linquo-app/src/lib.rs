mod db;
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
        .invoke_handler(tauri::generate_handler![db::kv_get, db::kv_put, db::kv_rm])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
