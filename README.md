# PRMPTR

Real-time AI conversation assistant for Windows/macOS/Linux. PRMPTR listens to
your microphone and system audio (or reads screen activity via
[screenpipe](https://screenpipe.com)), transcribes it live, and streams
context-aware response suggestions to an always-on-top overlay — so you always
have the right thing to say.

Built with **Tauri v2 + Next.js 16 + React 19**, with local Whisper and cloud
Deepgram transcription, and Anthropic/OpenAI/Groq/Cerebras or local LM Studio
as the LLM backend.

## Prerequisites

- Node.js 20+
- Rust toolchain (rustup) with the MSVC target on Windows
- Tauri v2 system dependencies ([guide](https://tauri.app/start/prerequisites/))
- For local Whisper: no extra setup (models download in-app)
- For screen capture features: [screenpipe](https://screenpipe.com) installed
  (the app can install it for you on first run)

## Getting started

```bash
npm install

# Dev (Next.js dev server on http://127.0.0.1:3000 + Tauri shell)
npm run tauri dev

# Production build
npm run tauri build
```

Useful scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server bound to `127.0.0.1` |
| `npm run build` | Production Next.js build |
| `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit tests |

## First-run setup

1. Launch the app; open **Settings**.
2. Pick a transcription mode:
   - **Local Whisper** — private, runs fully on-device (GPU optional).
   - **Direct Deepgram** — low-latency cloud transcription; requires a Deepgram API key.
3. Configure your input ("You") and output ("Them") audio devices.
4. Add an LLM provider key (Anthropic / OpenAI / Groq / Cerebras), or use a
   locally running LM Studio server.
5. Choose a personality and start a session.

## Privacy model

- Transcripts, screenshots, and session history stay **on your machine**
  (IndexedDB). Nothing is synced.
- Secrets are stored outside localStorage via the Tauri secure store.
- Cloud transcription/vision only activates for modes you explicitly enable;
  the default flow keeps everything local where possible.

## Project structure

```
app/            Next.js routes (incl. guarded local-only API routes)
components/     React UI
hooks/          Feed, history, shortcut hooks
lib/            Zustand stores, LLM providers, prompt builder, guards
src-tauri/      Rust backend: capture, transcription, session, TTS
docs/           Architecture notes
```

See [docs/architecture.md](docs/architecture.md) before changing LLM-related code.
