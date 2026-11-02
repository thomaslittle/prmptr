# PRMPTR

Real-time AI conversation wingman. PRMPTR listens to your microphone ("You")
and system audio ("Them"), transcribes both **on your device**, and streams
context-aware suggestions — answers, comebacks, facts — in the personality you
pick.

Built with **Tauri 2 · Next.js 16 (static export) · React 19 · Rust**.

## Highlights

- **On-device speech recognition** — [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)
  runs GGUF models locally; nothing leaves your machine.
  - **Parakeet Unified (English)** by default: ~1.6% WER, punctuated, >15× real
    time on an ordinary desktop CPU.
  - Also: Parakeet v3 (25 European languages), Whisper Large v3 Turbo
    (99 languages), Moonshine Small and Parakeet 110M for low-power machines.
  - **Silero VAD v6.2** gates the models so silence and room noise never reach
    them (no "Thank you." hallucinations).
  - Models download on demand from pinned revisions and are SHA-256 verified.
  - **Personal glossary** — names and jargon bias recognition, and known
    mishearings are corrected (`Saoirse = Sayers`).
  - **Speaker names** — rename "Speaker 2" to "Sarah" in the live feed; the
    AI sees who said what.
  - Optional GPU builds via Vulkan (NVIDIA/AMD/Intel) or CUDA.
- **Deepgram** as the one cloud transcription option.
- **Your AI apps** — use the subscriptions you already have (Claude Code, Codex,
  OpenCode, Gemini CLI, Ollama, LM Studio…) through
  [OriginLM](https://github.com/thomaslittle/originlm). Turns run *through* the
  installed client; PRMPTR never reads or copies your logins.
- **API providers** — Anthropic (Claude Haiku/Sonnet/Opus 5.5), OpenAI
  (GPT-6.x), Groq, Cerebras, OpenCode Zen, or a local LM Studio server. Live
  model lists come from each provider; Groq ⇄ Cerebras fail over on rate limits.
- **Always-on-top overlay** (opt-in) — suggestions stream into a small
  floating window that's hidden from screen sharing; `Ctrl+Shift+H` show/hide,
  `Ctrl+Shift+C` click-through.
- **10 personalities**, global shortcuts, optional screenshot context for vision
  models, local or HTTP text-to-speech, and session history stored locally.

## Getting started

Prerequisites: Node.js 22+, the Rust toolchain (MSVC on Windows), CMake, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/). On Linux, system
audio needs a PulseAudio or PipeWire monitor source and `parec` (package
`pulseaudio-utils` on Debian/Ubuntu, or `pipewire-pulse`).

```bash
npm install
npm run tauri dev          # desktop app with hot reload (http://127.0.0.1:43110)
npm run tauri build        # production installers (NSIS/MSI, .deb)
npm run tauri:dev:gpu      # dev build with the Vulkan GPU backend (needs the Vulkan SDK)
```

First run: **Settings → Capture & Voice** → download Parakeet Unified (731 MB,
one time) → pick your microphone and output device → **Start**. Then pick a
model under **Providers & Models** (or let *Your AI apps* find the ones you
already have) and press **Analyze** (`Ctrl+Shift+Space`).

## Testing

| Command | What it covers |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript 6 strict, ESLint 10 |
| `npm test` | Vitest unit tests (prompting, model migration, providers, …) |
| `npm run test:e2e` | Playwright against the production static export with an in-page fake of the Rust backend and intercepted provider APIs |
| `npm run test:rust` | Rust unit tests (VAD segmenter, model catalog, OriginLM mapping, …) |
| `PRMPTR_TEST_MODELS=<dir> cargo test --test real_audio` | Real audio through Silero VAD v6.2 + Parakeet |
| `npm run test:all` | Everything above except the real-audio test |

## Privacy

- Transcription is on-device unless you choose Deepgram.
- Transcripts and history stay in local IndexedDB; nothing is synced.
- API keys live in a Tauri-managed store file, never in localStorage.
- *Your AI apps* never exposes subscription credentials to PRMPTR.
- The webview can only reach the provider APIs and loopback addresses allowed
  in `src-tauri/capabilities/default.json`.

See [docs/architecture.md](docs/architecture.md) for the full design.

## Project structure

```
app/            Next.js routes (static export — no API routes)
components/     React UI (dashboard, analysis, settings, model picker)
lib/            Stores, LLM client/providers, Tauri bridge, prompt builder
src-tauri/      Rust: audio capture, transcribe.cpp engine + VAD, Deepgram,
                OriginLM bridge, screenshots, TTS
e2e/            Playwright suite and the fake Rust backend
```
