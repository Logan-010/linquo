mod model;

use color_eyre::eyre::{Result, ensure, eyre};
use hf_hub::{
    HFClient,
    progress::{DownloadEvent, FileStatus, ProgressEvent, ProgressHandler},
};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager};

const REPOSITORY_OWNER: &str = "supertone-oss-archive";
const REPOSITORY: &str = "supertonic-3";
const REVISION: &str = "aafc6e32416a594460b32413efc49d7fe4ce6d46";
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
    weights: tokio::sync::Mutex<()>,
    model: Mutex<Option<model::Model>>,
    download: Mutex<DownloadProgress>,
    request: Mutex<Option<(String, Arc<AtomicBool>)>>,
    cache: Mutex<VecDeque<(String, f32, Vec<u8>)>>,
}

impl Synthesis {
    fn begin(&self, id: String) -> Result<Arc<AtomicBool>, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut request = self
            .request
            .lock()
            .map_err(|_| "Speech worker unavailable")?;
        if let Some((_, previous)) = request.replace((id, cancelled.clone())) {
            previous.store(true, Ordering::Relaxed);
        }
        Ok(cancelled)
    }

    fn cancel(&self, id: &str) -> Result<(), String> {
        let request = self
            .request
            .lock()
            .map_err(|_| "Speech worker unavailable")?;
        if let Some((current, cancelled)) = request.as_ref()
            && current == id
        {
            cancelled.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
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
    let state = app.state::<Synthesis>();
    let _guard = state.weights.lock().await;
    let root = directory(&app).map_err(|e| format!("{e:#}"))?;
    let progress_app = app.clone();
    let result = download_weights(&root, move |downloaded, total, file| {
        let state = progress_app.state::<Synthesis>();
        if let Ok(mut progress) = state.download.lock() {
            *progress = DownloadProgress {
                active: true,
                downloaded,
                total,
                file: file.to_owned(),
                error: None,
            };
        }
    })
    .await;
    if let Ok(mut progress) = state.download.lock() {
        progress.active = false;
        progress.error = result.as_ref().err().map(|error| format!("{error:#}"));
    }
    result.map_err(|e| format!("{e:#}"))
}

#[derive(Clone)]
struct FileProgress<F> {
    callback: Arc<Mutex<F>>,
    downloaded: Arc<Mutex<u64>>,
    completed: u64,
    size: u64,
    total: u64,
    file: String,
}

impl<F: FnMut(u64, u64, &str) + Send> ProgressHandler for FileProgress<F> {
    fn on_progress(&self, event: &ProgressEvent) {
        let completed = match event {
            ProgressEvent::Download(DownloadEvent::Progress { files }) => files
                .iter()
                .filter(|file| file.filename == self.file)
                .map(|file| {
                    if file.status == FileStatus::Complete {
                        self.size
                    } else {
                        file.bytes_completed
                    }
                })
                .max()
                .unwrap_or(0),
            ProgressEvent::Download(DownloadEvent::AggregateProgress {
                bytes_completed, ..
            }) => *bytes_completed,
            ProgressEvent::Download(DownloadEvent::Complete) => self.size,
            _ => return,
        };
        let mut downloaded = self.downloaded.lock().unwrap();
        // File and aggregate events both contain cumulative counts and may overlap.
        *downloaded = (*downloaded).max(completed).min(self.size);
        (self.callback.lock().unwrap())(self.completed + *downloaded, self.total, &self.file);
    }
}

async fn download_weights(
    root: &std::path::Path,
    progress: impl FnMut(u64, u64, &str) + Clone + Send + 'static,
) -> Result<()> {
    let progress = Arc::new(Mutex::new(progress));
    let total = FILES.iter().map(|(_, size)| size).sum();
    let mut downloaded = 0;
    let mut missing = Vec::new();
    for &(file, size) in FILES {
        if tokio::fs::metadata(root.join(file))
            .await
            .is_ok_and(|m| m.is_file() && m.len() == size)
        {
            downloaded += size;
        } else {
            missing.push((file, size));
        }
    }
    (progress.lock().unwrap())(downloaded, total, "");
    // Keep the Hub cache inside the app cache so deleting weights removes it too.
    let repo = HFClient::builder()
        .cache_dir(root.join("hf-hub"))
        .build()?
        .model(REPOSITORY_OWNER, REPOSITORY);
    for (file, size) in missing {
        let path = root.join(file);
        tokio::fs::create_dir_all(path.parent().unwrap()).await?;
        let partial = path.with_extension("part");
        (progress.lock().unwrap())(downloaded, total, file);
        let result: Result<()> = async {
            let cached = repo
                .download_file()
                .filename(file)
                .revision(REVISION)
                .progress(FileProgress {
                    callback: progress.clone(),
                    downloaded: Arc::new(Mutex::new(0)),
                    completed: downloaded,
                    size,
                    total,
                    file: file.to_owned(),
                })
                .send()
                .await?;
            ensure!(
                tokio::fs::metadata(&cached).await?.len() == size,
                "Unexpected model size: {file}"
            );
            let _ = tokio::fs::remove_file(&partial).await;
            let cached = tokio::fs::canonicalize(cached).await?;
            if tokio::fs::hard_link(&cached, &partial).await.is_err() {
                tokio::fs::copy(&cached, &partial).await?;
            }
            tokio::fs::rename(&partial, &path).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(partial).await;
        }
        result?;
        downloaded += size;
    }
    (progress.lock().unwrap())(total, total, "");
    Ok(())
}

#[tauri::command]
pub async fn delete_synthesis_weights(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Synthesis>();
    let _guard = state.weights.lock().await;
    let app = app.clone();
    blocking(move || {
        let state = app.state::<Synthesis>();
        let mut model = state
            .model
            .lock()
            .map_err(|_| eyre!("Speech worker unavailable"))?;
        *model = None;
        state
            .cache
            .lock()
            .map_err(|_| eyre!("Speech cache unavailable"))?
            .clear();
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
pub async fn speek(
    app: AppHandle,
    text: String,
    rate: Option<f32>,
    request_id: String,
) -> Result<tauri::ipc::Response, String> {
    let rate = rate.unwrap_or(1.0);
    if !rate.is_finite() || !(0.5..=1.5).contains(&rate) {
        return Err("Invalid speech rate".into());
    }
    let cancelled = app.state::<Synthesis>().begin(request_id)?;
    let started = std::time::Instant::now();
    let result = blocking(move || {
        ensure!(
            !text.trim().is_empty() && text.chars().count() <= 2000,
            "Speech text must contain 1–2000 characters"
        );
        let state = app.state::<Synthesis>();
        let check = || {
            ensure!(!cancelled.load(Ordering::Relaxed), "Speech cancelled");
            Ok(())
        };
        check()?;
        {
            let mut cache = state
                .cache
                .lock()
                .map_err(|_| eyre!("Speech cache unavailable"))?;
            if let Some(index) = cache
                .iter()
                .position(|(key, speed, _)| key == &text && *speed == rate)
            {
                let entry = cache.remove(index).unwrap();
                let bytes = entry.2.clone();
                cache.push_back(entry);
                return Ok(tauri::ipc::Response::new(bytes));
            }
        }
        let mut model = state
            .model
            .lock()
            .map_err(|_| eyre!("Speech worker unavailable"))?;
        check()?;
        let root = directory(&app)?;
        ensure!(ready(&root), "Download speech weights in Settings first");
        if model.is_none() {
            *model = Some(model::Model::load(&root)?);
        }
        let (samples, sample_rate) = model.as_mut().unwrap().speak(&text, rate, check)?;
        check()?;
        let mut bytes = Vec::with_capacity(4 + samples.len() * 4);
        bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        // Bound cached PCM to 32 MiB; repeated words/replays skip inference entirely.
        const CACHE_LIMIT: usize = 32 * 1024 * 1024;
        if bytes.len() <= CACHE_LIMIT {
            let mut cache = state
                .cache
                .lock()
                .map_err(|_| eyre!("Speech cache unavailable"))?;
            let mut size: usize = cache.iter().map(|(_, _, bytes)| bytes.len()).sum();
            while size + bytes.len() > CACHE_LIMIT {
                if let Some((_, _, oldest)) = cache.pop_front() {
                    size -= oldest.len();
                }
            }
            cache.push_back((text, rate, bytes.clone()));
        }
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await;
    match &result {
        Ok(_) => log::info!("Speech ready in {:.2}s", started.elapsed().as_secs_f32()),
        Err(error) if error == "Speech cancelled" => log::debug!("Speech cancelled"),
        Err(error) => log::error!("Speech synthesis failed: {error}"),
    }
    result
}

#[tauri::command]
pub fn cancel_speech(state: tauri::State<'_, Synthesis>, request_id: String) -> Result<(), String> {
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_progress_handles_overlapping_events_and_cache_hits() {
        let observed = Arc::new(Mutex::new(Vec::new()));
        let updates = observed.clone();
        let progress = FileProgress {
            callback: Arc::new(Mutex::new(move |downloaded, total, file: &str| {
                assert_eq!(total, 150);
                assert_eq!(file, "model.onnx");
                updates.lock().unwrap().push(downloaded);
            })),
            downloaded: Arc::new(Mutex::new(0)),
            completed: 50,
            size: 100,
            total: 150,
            file: "model.onnx".into(),
        };
        for bytes_completed in [40, 40, 20, 200] {
            progress.on_progress(
                &DownloadEvent::AggregateProgress {
                    bytes_completed,
                    total_bytes: 100,
                    bytes_per_sec: None,
                }
                .into(),
            );
        }
        progress.on_progress(&DownloadEvent::Complete.into());
        assert_eq!(*observed.lock().unwrap(), [90, 90, 90, 150, 150]);

        // Cache hits can report completion with zero bytes and no Start event.
        *progress.downloaded.lock().unwrap() = 0;
        progress.on_progress(
            &DownloadEvent::Progress {
                files: vec![hf_hub::progress::FileProgress {
                    filename: "model.onnx".into(),
                    bytes_completed: 0,
                    total_bytes: 0,
                    status: FileStatus::Complete,
                }],
            }
            .into(),
        );
        assert_eq!(*observed.lock().unwrap().last().unwrap(), 150);
    }

    #[test]
    fn new_speech_cancels_old_inference_and_late_cancellation_is_scoped() {
        let state = Synthesis::default();
        let first = state.begin("word".into()).unwrap();
        let second = state.begin("sentence".into()).unwrap();
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        state.cancel("word").unwrap();
        assert!(!second.load(Ordering::Relaxed));
        state.cancel("sentence").unwrap();
        assert!(second.load(Ordering::Relaxed));
    }

    /// Explicit opt-in: downloads ~400 MB to LINQUO_SPEECH_TEST_DIR.
    #[test]
    #[ignore = "requires network and Supertonic weights"]
    fn supertonic_smoke() -> Result<()> {
        let root = PathBuf::from(std::env::var("LINQUO_SPEECH_TEST_DIR")?);
        let last = Arc::new(Mutex::new(0));
        let observed = last.clone();
        tauri::async_runtime::block_on(download_weights(&root, move |downloaded, total, _| {
            let mut last = observed.lock().unwrap();
            assert!(downloaded >= *last && downloaded <= total);
            *last = downloaded;
        }))?;
        assert_eq!(
            *last.lock().unwrap(),
            FILES.iter().map(|(_, size)| size).sum::<u64>()
        );
        assert!(ready(&root));
        let mut model = model::Model::load(&root)?;
        for text in ["Hello, how are you today?", "안녕하세요", "agua"] {
            let (samples, rate) = model.speak(text, 1.0, || Ok(()))?;
            assert_eq!(rate, 44100);
            assert!(samples.len() > rate / 10);
            assert!(
                samples
                    .iter()
                    .all(|sample| sample.is_finite() && sample.abs() <= 1.0)
            );
            assert!(samples.iter().any(|sample| sample.abs() > 0.001));
        }
        let (normal, normal_rate) = model.speak("Hello there.", 1.0, || Ok(()))?;
        let (slow, slow_rate) = model.speak("Hello there.", 0.75, || Ok(()))?;
        assert_eq!(normal_rate, slow_rate);
        assert!(slow.len() > normal.len());
        let cancelled = model.speak("Cancelled.", 1.0, || {
            color_eyre::eyre::bail!("Speech cancelled")
        });
        assert!(cancelled.unwrap_err().to_string().contains("cancelled"));
        Ok(())
    }
}
