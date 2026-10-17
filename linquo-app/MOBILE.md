# Mobile inference and Android builds

Speech synthesis uses `tract-onnx` 0.23.9 for CPU inference on desktop and
mobile. It builds from source, including architecture-specific kernels, rather
than downloading or linking Microsoft ONNX Runtime binaries. No `ort-sys`,
`ORT_LIB_LOCATION`, or packaged `libonnxruntime.so` is needed.

The Android targets include:

| Rust target | Android ABI | Tauri target |
| --- | --- | --- |
| `armv7-linux-androideabi` | `armeabi-v7a` | `armv7` |
| `aarch64-linux-android` | `arm64-v8a` | `aarch64` |
| `i686-linux-android` | `x86` | `i686` |
| `x86_64-linux-android` | `x86_64` | `x86_64` |

## Build

Install the [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/#android):
Android Studio, SDK, NDK, and a JDK, with `JAVA_HOME`, `ANDROID_HOME`, and
`NDK_HOME` configured. The NDK compiler is needed for tract's native kernels
and the application's other native dependencies. Use the project's nightly
Rust toolchain (the workspace uses nightly rustflags).

With a rustup-managed toolchain:

```sh
rustup target add armv7-linux-androideabi aarch64-linux-android i686-linux-android x86_64-linux-android
```

From `linquo-app`, initialize the Android project once, then build:

```sh
cargo tauri android init
cargo tauri android build --target armv7
cargo tauri android build --target aarch64
cargo tauri android build --target i686
cargo tauri android build --target x86_64
```

The Nix development shell currently supplies the desktop toolchain and libraries;
it does not provision the Android SDK/NDK or Android Rust standard libraries.

## Model compatibility and verification

The existing Supertonic ONNX files and voice files are used unchanged. Execution
plans specialize to the current input shapes, with one cached plan per component
to reuse across diffusion steps without retaining every previous text length.
Intermediate shapes are inferred from those inputs. Native kernel code generation
is enabled, but its broadcast-removal declutter pass is skipped because 0.23.9
misoptimizes the estimator's batch `Tile` followed by convolution. The dependency
is pinned because this workaround depends on that version's optimizer pass order.
Development builds optimize tract's numerical crates at level 3 while leaving
application code debuggable. Benchmark release builds on intended devices,
especially memory-constrained 32-bit devices.

Inference uses a shared pool of up to four CPU workers (bounded by available
parallelism) and reuses execution state between diffusion passes. This avoids
creating per-request thread pools and repeatedly initializing operator state.
Five diffusion steps are retained to preserve synthesis quality. Debug logs in
the synthesis model report plan construction and execution separately.

## Inference speed

Use `cargo tauri dev` with the workspace's numerical-crate optimization settings,
or `cargo tauri build` for a fully optimized build. The first build after changing
these settings takes longer; subsequent speech generation is substantially faster.
The backend logs elapsed time as `Speech ready in …s` and caches completed PCM,
so exact repeats at the same speech rate avoid inference altogether.

The two-text inference test took approximately 50.5 seconds with plain, unoptimized
typed plans, 25.6 seconds with native kernel code generation, and 3.2 seconds with
both native code generation and optimized numerical crates on the migration
machine. These timings include loading the models and are not device guarantees.

The opt-in smoke test loads all four models and generates finite, non-silent audio
for two text lengths:

```sh
LINQUO_TEST_MODEL_DIR=/path/to/supertonic-3 \
  cargo test -p linquo --lib synthesizes_with_tract -- --ignored --nocapture
```

The directory must contain `onnx/` and `voice_styles/`, as in the application's
download cache. Desktop inference was tested during migration. Android builds
and on-device execution still need verification with an installed SDK/NDK.
