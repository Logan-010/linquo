//! Single-voice CPU inference adapted from Supertone's Supertonic Rust example.
//! See THIRD_PARTY.md for attribution.
use color_eyre::eyre::{Result, ensure, eyre};
use ndarray::{Array, Array3};
use ort::{
    session::{Session, SessionInputValue},
    value::Tensor,
};
use rand_distr::{Distribution, StandardNormal};
use serde::Deserialize;
use std::{fs::File, io::BufReader, path::Path};
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
        let environment = ort::init().with_name("linquo-synthesis").build()?;
        let session = |name: &str| -> Result<Session> {
            Ok(Session::builder(&environment)?
                .with_intra_threads(2)
                .map_err(ort::Error::<()>::from)?
                .commit_from_file(root.join(format!("onnx/{name}.onnx")))?)
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
            let mask = Tensor::from_array(Array3::<f32>::ones((1, 1, ids.len())))?;
            let ids = Tensor::from_array(Array::from_shape_vec((1, ids.len()), ids)?)?;
            let dp = Tensor::from_array(self.dp.clone())?;
            let ttl = Tensor::from_array(self.ttl.clone())?;
            let outputs = self.duration.run(vec![
                ("text_ids", SessionInputValue::from(ids.view())),
                ("style_dp", dp.view().into()),
                ("text_mask", mask.view().into()),
            ])?;
            let duration = *outputs["duration"]
                .try_extract_tensor::<f32>()?
                .1
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
                ("text_ids", SessionInputValue::from(ids.view())),
                ("style_ttl", ttl.view().into()),
                ("text_mask", mask.view().into()),
            ])?;
            let embedding = &outputs["text_emb"];
            let compress = self.config.ttl.chunk_compress_factor;
            let length = samples.div_ceil(self.config.ae.base_chunk_size * compress);
            let mut rng = rand::rng();
            let mut latent = Tensor::from_array(Array3::<f32>::from_shape_fn(
                (1, self.config.ttl.latent_dim * compress, length),
                |_| StandardNormal.sample(&mut rng),
            ))?;
            let latent_mask = Tensor::from_array(Array3::<f32>::ones((1, 1, length)))?;
            const STEPS: usize = 5;
            let total = Tensor::from_array(Array::from_elem(1, STEPS as f32))?;
            for step in 0..STEPS {
                check()?;
                let current = Tensor::from_array(Array::from_elem(1, step as f32))?;
                let outputs = self.estimator.run(vec![
                    ("noisy_latent", SessionInputValue::from(latent.view())),
                    ("text_emb", embedding.view().into()),
                    ("style_ttl", ttl.view().into()),
                    ("latent_mask", latent_mask.view().into()),
                    ("text_mask", mask.view().into()),
                    ("current_step", current.view().into()),
                    ("total_step", total.view().into()),
                ])?;
                latent = Tensor::from_array(
                    outputs["denoised_latent"]
                        .try_extract_array::<f32>()?
                        .to_owned(),
                )?;
            }
            check()?;
            let outputs = self
                .vocoder
                .run(vec![("latent", SessionInputValue::from(latent.view()))])?;
            let (_, data) = outputs["wav_tts"].try_extract_tensor::<f32>()?;
            audio.extend(data.iter().take(samples).map(|v| v.clamp(-1.0, 1.0)));
        }
        Ok((audio, self.config.ae.sample_rate))
    }
}

#[cfg(test)]
mod tests {
    use super::chunks;

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
