//! Single-voice CPU inference adapted from Supertone's Supertonic Rust example.
//! See THIRD_PARTY.md for attribution.
use color_eyre::eyre::{Result, ensure, eyre};
use rand_distr::{Distribution, StandardNormal};
use serde::Deserialize;
use std::{collections::HashMap, fs::File, io::BufReader, path::Path};
use tract_onnx::prelude::tract_ndarray::{Array, Array3};
use tract_onnx::prelude::*;
use unicode_normalization::UnicodeNormalization;

#[derive(Deserialize)]
struct Config {
    ae: AudioConfig,
    ttl: LatentConfig,
}
#[derive(Deserialize)]
struct AudioConfig {
    sample_rate: usize,
    base_chunk_size: usize,
}
#[derive(Deserialize)]
struct LatentConfig {
    chunk_compress_factor: usize,
    latent_dim: usize,
}
#[derive(Deserialize)]
struct Component {
    data: Vec<Vec<Vec<f32>>>,
    dims: [usize; 3],
}
#[derive(Deserialize)]
struct Voice {
    style_ttl: Component,
    style_dp: Component,
}

fn json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    Ok(serde_json::from_reader(BufReader::new(File::open(path)?))?)
}
fn style(component: Component) -> Result<Array3<f32>> {
    let [a, b, c] = component.dims;
    Ok(Array3::from_shape_vec(
        (a, b, c),
        component.data.into_iter().flatten().flatten().collect(),
    )?)
}

fn chunks(text: &str) -> Vec<&str> {
    let mut remaining = text.trim();
    let mut result = Vec::new();
    while !remaining.is_empty() {
        let limit = remaining
            .char_indices()
            .nth(120)
            .map_or(remaining.len(), |(i, _)| i);
        let end = if limit < remaining.len() {
            // Prefer sentence or word boundaries, never split a UTF-8 code point.
            remaining[..limit]
                .char_indices()
                .rev()
                .find(|(_, c)| {
                    c.is_whitespace() || matches!(c, '.' | '!' | '?' | '。' | '！' | '？')
                })
                .map_or(limit, |(i, c)| i + c.len_utf8())
        } else {
            limit
        };
        result.push(remaining[..end].trim());
        remaining = remaining[end..].trim_start();
    }
    result
}

/// Keep one shape-specialized plan per component. This bounds memory use while
/// reusing the estimator's plan across all diffusion steps in a speech chunk.
struct Session {
    model: InferenceModel,
    inputs: Vec<String>,
    outputs: Vec<String>,
    plan: Option<(Vec<Vec<usize>>, TypedSimpleState)>,
}

impl Session {
    fn load(path: &Path) -> Result<Self> {
        let model = tract_onnx::onnx()
            // Re-infer intermediate shapes from each concrete input length.
            .with_ignore_value_info(true)
            .model_for_path(path)
            .map_err(inference_error)?;
        let inputs = model
            .input_outlets()
            .map_err(inference_error)?
            .iter()
            .map(|outlet| model.node(outlet.node).name.clone())
            .collect();
        let outputs = model
            .output_outlets()
            .map_err(inference_error)?
            .iter()
            .map(|outlet| {
                model
                    .outlet_label(*outlet)
                    .unwrap_or(&model.node(outlet.node).name)
                    .to_owned()
            })
            .collect();
        Ok(Self {
            model,
            inputs,
            outputs,
            plan: None,
        })
    }

    fn run(&mut self, values: Vec<(&str, Tensor)>) -> Result<HashMap<String, TValue>> {
        let mut values: HashMap<_, _> = values.into_iter().collect();
        let inputs: TVec<TValue> = self
            .inputs
            .iter()
            .map(|name| {
                values
                    .remove(name.as_str())
                    .map(IntoTValue::into_tvalue)
                    .ok_or_else(|| eyre!("Missing model input {name}"))
            })
            .collect::<Result<_>>()?;
        ensure!(values.is_empty(), "Unexpected model inputs");
        let shapes: Vec<_> = inputs.iter().map(|value| value.shape().to_vec()).collect();
        if self
            .plan
            .as_ref()
            .is_none_or(|(cached, _)| *cached != shapes)
        {
            let started = std::time::Instant::now();
            // Release the previous plan before specializing a new sequence length.
            self.plan = None;
            let mut model = self.model.clone();
            for (index, value) in inputs.iter().enumerate() {
                model
                    .set_input_fact(
                        index,
                        InferenceFact::dt_shape(value.datum_type(), value.shape()),
                    )
                    .map_err(inference_error)?;
            }
            let mut model = model.into_typed().map_err(inference_error)?;
            // Enable native matrix/convolution kernels without the broken
            // broadcast-removal declutter pass in tract 0.23.9. Plain typed
            // plans otherwise execute expensive reference implementations.
            let mut optimizer = tract_onnx::tract_core::optim::Optimizer::codegen();
            optimizer.passes.remove(3);
            optimizer.optimize(&mut model).map_err(inference_error)?;
            // Share a bounded pool across components; avoid oversubscribing
            // mobile CPUs or spawning a new pool for every input shape.
            static EXECUTOR: std::sync::OnceLock<tract_linalg::multithread::Executor> =
                std::sync::OnceLock::new();
            let executor = EXECUTOR.get_or_init(|| {
                let threads = std::thread::available_parallelism()
                    .map_or(1, usize::from)
                    .min(4);
                tract_linalg::multithread::Executor::multithread(threads)
            });
            let options = tract_onnx::tract_core::runtime::RunOptions {
                executor: Some(executor.clone()),
                ..Default::default()
            };
            let plan = model
                .into_runnable_with_options(&options)
                .map_err(inference_error)?;
            self.plan = Some((
                shapes,
                TypedSimpleState::new(&plan).map_err(inference_error)?,
            ));
            log::debug!(
                "{} plan built in {:?}",
                self.outputs.join(","),
                started.elapsed()
            );
        }
        let started = std::time::Instant::now();
        let outputs = self
            .plan
            .as_mut()
            .unwrap()
            .1
            .run(inputs)
            .map_err(inference_error)?;
        log::debug!(
            "{} execution took {:?}",
            self.outputs.join(","),
            started.elapsed()
        );
        Ok(self.outputs.iter().cloned().zip(outputs).collect())
    }
}

fn inference_error(error: impl std::fmt::Display) -> color_eyre::Report {
    eyre!("ONNX inference: {error:#}")
}

fn floats(value: &TValue) -> Result<&[f32]> {
    value
        .as_plain_ram()
        .ok_or_else(|| eyre!("Expected CPU tensor"))?
        .as_slice::<f32>()
        .map_err(inference_error)
}

pub struct Model {
    config: Config,
    indexer: Vec<i64>,
    ttl: Array3<f32>,
    dp: Array3<f32>,
    duration: Session,
    encoder: Session,
    estimator: Session,
    vocoder: Session,
}

impl Model {
    pub fn load(root: &Path) -> Result<Self> {
        let config: Config = json(&root.join("onnx/tts.json"))?;
        ensure!(
            config.ae.sample_rate > 0
                && config.ae.base_chunk_size > 0
                && config.ttl.chunk_compress_factor > 0,
            "Invalid speech configuration"
        );
        let voice: Voice = json(&root.join("voice_styles/M1.json"))?;
        let session = |name: &str| -> Result<Session> {
            Session::load(&root.join(format!("onnx/{name}.onnx")))
        };
        Ok(Self {
            config,
            indexer: json(&root.join("onnx/unicode_indexer.json"))?,
            ttl: style(voice.style_ttl)?,
            dp: style(voice.style_dp)?,
            duration: session("duration_predictor")?,
            encoder: session("text_encoder")?,
            estimator: session("vector_estimator")?,
            vocoder: session("vocoder")?,
        })
    }

    pub fn speak(
        &mut self,
        text: &str,
        rate: f32,
        check: impl Fn() -> Result<()>,
    ) -> Result<(Vec<f32>, usize)> {
        check()?;
        // Language-agnostic tags support mixed source/target prompts without guessing
        // their language from the exercise's instruction or romanization.
        let normalized: String = text
            .replace(['_', '[', ']', '|', '/', '#'], " ")
            .replace(['–', '‑', '—'], "-")
            .replace(['“', '”'], "\"")
            .replace(['‘', '’', '`'], "'");
        let normalized = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
        ensure!(!normalized.is_empty(), "No text to speak");
        let mut audio = Vec::new();
        // Chunk before NFKD so Korean syllables remain intact at boundaries.
        for chunk in chunks(&normalized) {
            check()?;
            if !audio.is_empty() {
                audio.resize(audio.len() + self.config.ae.sample_rate / 5, 0.0);
            }
            let mut text: String = chunk.nfkd().collect();
            if !text.ends_with(['.', '!', '?', '。', '！', '？']) {
                text.push('.');
            }
            let text = format!("<na>{text}</na>");
            let ids: Vec<i64> = text
                .chars()
                .map(|c| self.indexer.get(c as usize).copied().unwrap_or(-1))
                .collect();
            let mask = Array3::<f32>::ones((1, 1, ids.len())).into_tensor();
            let ids = Array::from_shape_vec((1, ids.len()), ids)?.into_tensor();
            let dp = self.dp.clone().into_tensor();
            let ttl = self.ttl.clone().into_tensor();
            let outputs = self.duration.run(vec![
                ("text_ids", ids.clone()),
                ("style_dp", dp),
                ("text_mask", mask.clone()),
            ])?;
            let duration = *floats(&outputs["duration"])?
                .first()
                .ok_or_else(|| eyre!("Missing duration"))?
                / (1.05 * rate);
            ensure!(
                duration.is_finite() && duration > 0.0 && duration <= 60.0,
                "Invalid predicted speech duration"
            );
            let samples = (duration * self.config.ae.sample_rate as f32) as usize;
            check()?;
            let outputs = self.encoder.run(vec![
                ("text_ids", ids),
                ("style_ttl", ttl.clone()),
                ("text_mask", mask.clone()),
            ])?;
            let embedding = &outputs["text_emb"];
            let compress = self.config.ttl.chunk_compress_factor;
            let length = samples.div_ceil(self.config.ae.base_chunk_size * compress);
            let mut rng = rand::rng();
            let mut latent = Array3::<f32>::from_shape_fn(
                (1, self.config.ttl.latent_dim * compress, length),
                |_| StandardNormal.sample(&mut rng),
            )
            .into_tensor();
            let latent_mask = Array3::<f32>::ones((1, 1, length)).into_tensor();
            const STEPS: usize = 5;
            let total = Array::from_elem(1, STEPS as f32).into_tensor();
            for step in 0..STEPS {
                check()?;
                let current = Array::from_elem(1, step as f32).into_tensor();
                let outputs = self.estimator.run(vec![
                    ("noisy_latent", latent),
                    ("text_emb", embedding.clone().into_tensor()),
                    ("style_ttl", ttl.clone()),
                    ("latent_mask", latent_mask.clone()),
                    ("text_mask", mask.clone()),
                    ("current_step", current),
                    ("total_step", total.clone()),
                ])?;
                latent = outputs["denoised_latent"].clone().into_tensor();
            }
            check()?;
            let outputs = self.vocoder.run(vec![("latent", latent)])?;
            let data = floats(&outputs["wav_tts"])?;
            audio.extend(data.iter().take(samples).map(|v| v.clamp(-1.0, 1.0)));
        }
        Ok((audio, self.config.ae.sample_rate))
    }
}

#[cfg(test)]
mod tests {
    use super::chunks;

    /// Run explicitly with LINQUO_TEST_MODEL_DIR pointing to Supertonic's cache.
    #[test]
    #[ignore = "requires downloaded Supertonic models"]
    fn synthesizes_with_tract() -> color_eyre::eyre::Result<()> {
        let root = std::env::var("LINQUO_TEST_MODEL_DIR")?;
        let mut model = super::Model::load(std::path::Path::new(&root))?;
        for text in [
            "Hello.",
            "A longer sentence.",
            "Please choose the correct translation of this sentence from the options below.",
        ] {
            let started = std::time::Instant::now();
            let (audio, sample_rate) = model.speak(text, 1.0, || Ok(()))?;
            eprintln!(
                "{text:?}: {:?} for {:.2}s audio",
                started.elapsed(),
                audio.len() as f32 / sample_rate as f32
            );
            assert!(sample_rate > 0);
            assert!(!audio.is_empty());
            assert!(audio.iter().all(|sample| sample.is_finite()));
            assert!(audio.iter().any(|sample| sample.abs() > 0.001));
        }
        Ok(())
    }

    #[test]
    fn chunks_preserve_words_and_multibyte_text() {
        let sentence = "안녕하세요 language learning ".repeat(20);
        let parts = chunks(&sentence);
        assert!(parts.iter().all(|part| part.chars().count() <= 120));
        assert_eq!(parts.join(" "), sentence.trim());
        let unbroken = "한".repeat(250);
        assert_eq!(chunks(&unbroken).concat(), unbroken);
        assert!(chunks("  ").is_empty());
    }
}
