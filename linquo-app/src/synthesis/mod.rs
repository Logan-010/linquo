mod model;

use anyhow::{Result, ensure};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager};

const BASE: &str = "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46";
// Sizes belong to the pinned snapshot above; also reject truncated cache files.
const FILES: &[(&str, u64)] = &[
    ("onnx/tts.json", 8253),
    ("onnx/unicode_indexer.json", 277676),
    ("voice_styles/M1.json", 291748),
    ("onnx/duration_predictor.onnx", 3700147),
    ("onnx/text_encoder.onnx", 36416150),
    ("onnx/vector_estimator.onnx", 256534781),
    ("onnx/vocoder.onnx", 101424195),
    ("LICENSE", 15007),
];

#[derive(Default)]
pub struct Synthesis {
    model: Mutex<Option<model::Model>>,
    download: Mutex<DownloadProgress>,
}

#[derive(Clone, Default, serde::Serialize)]
pub struct DownloadProgress {
    active: bool,
    downloaded: u64,
    total: u64,
    file: String,
    error: Option<String>,
}

fn directory(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_cache_dir()?.join("supertonic-3"))
}
fn ready(root: &std::path::Path) -> bool {
    FILES.iter().all(|(file, size)| {
        root.join(file)
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == *size)
    })
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn synthesis_status(app: AppHandle) -> Result<bool, String> {
    blocking(move || Ok(ready(&directory(&app)?))).await
}

#[tauri::command]
pub fn synthesis_download_progress(
    state: tauri::State<'_, Synthesis>,
) -> Result<DownloadProgress, String> {
    state
        .download
        .lock()
        .map(|progress| progress.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_synthesis_weights(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let state = app.state::<Synthesis>();
        let _guard = state
            .model
            .lock()
            .map_err(|_| anyhow::anyhow!("Speech worker unavailable"))?;
        let root = directory(&app)?;
        let result = download_weights(&root, |downloaded, total, file| {
            if let Ok(mut progress) = state.download.lock() {
                *progress = DownloadProgress {
                    active: true,
                    downloaded,
                    total,
                    file: file.to_owned(),
                    error: None,
                };
            }
        });
        if let Ok(mut progress) = state.download.lock() {
            progress.active = false;
            progress.error = result.as_ref().err().map(|error| format!("{error:#}"));
        }
        result
    })
    .await
}

fn download_weights(
    root: &std::path::Path,
    mut progress: impl FnMut(u64, u64, &str),
) -> Result<()> {
    let total = FILES.iter().map(|(_, size)| size).sum();
    let mut downloaded = FILES
        .iter()
        .filter(|(file, size)| {
            root.join(file)
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() == *size)
        })
        .map(|(_, size)| size)
        .sum();
    progress(downloaded, total, "");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()?;
    for &(file, size) in FILES {
        let path = root.join(file);
        if path
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == size)
        {
            continue;
        }
        fs::create_dir_all(path.parent().unwrap())?;
        let partial = path.with_extension("part");
        progress(downloaded, total, file);
        let result = (|| -> Result<()> {
            let mut response = client
                .get(format!("{BASE}/{file}"))
                .send()?
                .error_for_status()?;
            let mut output = fs::File::create(&partial)?;
            let mut bytes = 0;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = response.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                output.write_all(&buffer[..count])?;
                bytes += count as u64;
                ensure!(bytes <= size, "Unexpected model size: {file}");
                progress(downloaded + bytes, total, file);
            }
            ensure!(bytes == size, "Incomplete model download: {file}");
            output.flush()?;
            drop(output);
            fs::rename(&partial, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(partial);
        }
        result?;
        downloaded += size;
    }
    progress(total, total, "");
    Ok(())
}

#[tauri::command]
pub async fn delete_synthesis_weights(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let state = app.state::<Synthesis>();
        let mut model = state
            .model
            .lock()
            .map_err(|_| anyhow::anyhow!("Speech worker unavailable"))?;
        *model = None;
        let root = directory(&app)?;
        if root.exists() {
            fs::remove_dir_all(root)?;
        }
        Ok(())
    })
    .await
}

/// Return mono float32 PCM as binary IPC; the webview handles playback.
#[tauri::command]
pub async fn speek(app: AppHandle, text: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || {
        ensure!(
            !text.trim().is_empty() && text.chars().count() <= 2000,
            "Speech text must contain 1–2000 characters"
        );
        let state = app.state::<Synthesis>();
        let mut model = state
            .model
            .lock()
            .map_err(|_| anyhow::anyhow!("Speech worker unavailable"))?;
        let root = directory(&app)?;
        ensure!(ready(&root), "Download speech weights in Settings first");
        if model.is_none() {
            *model = Some(model::Model::load(&root)?);
        }
        let (samples, rate) = model.as_mut().unwrap().speak(&text)?;
        let mut bytes = Vec::with_capacity(4 + samples.len() * 4);
        bytes.extend_from_slice(&(rate as u32).to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Explicit opt-in: downloads ~400 MB to LINQUO_SPEECH_TEST_DIR.
    #[test]
    #[ignore = "requires network and Supertonic weights"]
    fn supertonic_smoke() -> Result<()> {
        let root = PathBuf::from(std::env::var("LINQUO_SPEECH_TEST_DIR")?);
        let mut last = 0;
        download_weights(&root, |downloaded, total, _| {
            assert!(downloaded >= last && downloaded <= total);
            last = downloaded;
        })?;
        assert_eq!(last, FILES.iter().map(|(_, size)| size).sum::<u64>());
        assert!(ready(&root));
        let mut model = model::Model::load(&root)?;
        for text in ["Hello, how are you today?", "안녕하세요", "agua"] {
            let (samples, rate) = model.speak(text)?;
            assert_eq!(rate, 44100);
            assert!(samples.len() > rate / 10);
            assert!(
                samples
                    .iter()
                    .all(|sample| sample.is_finite() && sample.abs() <= 1.0)
            );
            assert!(samples.iter().any(|sample| sample.abs() > 0.001));
        }
        Ok(())
    }
}
