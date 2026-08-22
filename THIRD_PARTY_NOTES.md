# Third-Party Components & Model Licenses

PRMPTR is MIT-licensed, but bundles/downloads components with their own
licenses. If you redistribute builds, review this list.

## Speech models

| Component | License | Notes |
|---|---|---|
| Whisper (OpenAI) | MIT | Model weights via [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp); inference through [whisper-rs](https://github.com/twebber/whisper-rs) (MIT) |
| Moonshine (Moonshine AI) | MIT | English base model, int8 ONNX from [k2-fsa/sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) |
| Silero VAD | MIT | Voice activity detection |

## Rust crates

| Crate | License | Use |
|---|---|---|
| Tauri v2 | MIT/Apache-2.0 | App framework |
| whisper-rs / whisper.cpp | MIT | Local STT |
| sherpa-rs / sherpa-onnx | Apache-2.0 | Moonshine/VAD/speaker ID/Kokoro TTS |
| cpal | Apache-2.0/MIT | Audio capture |
| reqwest, tokio, serde, etc. | MIT/Apache-2.0 | Standard stack |

`cargo license` inside `src-tauri/` gives the full dependency list.

## Frontend packages

Next.js, React, Tauri API/plugins, Dexie, Zustand, TanStack Query, TipTap,
react-markdown — all MIT or equivalent permissive; see `package.json` and
their respective repos.

## External services (opt-in only)

- **screenpipe** ([repo](https://github.com/mediar-ai/screenpipe)) — optional
  screen/audio capture engine; separately licensed by its authors. Not
  bundled; the app can download/install it on request.
- **OpenCode Zen**, Deepgram, Anthropic, OpenAI, Groq, Cerebras — cloud APIs
  used only when you configure keys for them. Your usage is governed by each
  provider's terms.

## Privacy-relevant model notes

Some Zen free-tier models operate under data-collection or zero-retention
policies during their free period (documented in
[OpenCode Zen's docs](https://opencode.ai/docs/zen/#privacy)). The app shows
these models with a "free" label; choose paid/local options if that matters
for your threat model.
