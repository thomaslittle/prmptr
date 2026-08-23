# PRMPTR

Real-time AI conversation wingman. PRMPTR listens to your microphone and
system audio, transcribes everything **locally on-device**, and streams
context-aware response suggestions — roasts, comebacks, answers, facts — to an
always-on-top overlay in the personality you pick. You always have the right
thing to say.

Built with **Tauri v2 + Next.js 16 + React 19 + Rust**.

## Highlights

- **100% local transcription (default)** — no API key needed to start
  - **Moonshine** engine: 2026's best live-speech STT — matches Whisper
    Large-v3 accuracy at 6× fewer params, ~50–270ms latency, MIT licensed.
    One-click ~240MB model download.
  - **Whisper** engine via whisper.cpp with downloadable models up to
    **Large-v3-Turbo** (quantized). The app auto-selects the best installed
    model.
  - **GPU acceleration** on NVIDIA cards (CUDA) with full detection
    diagnostics and setup hints built into Settings.
- **10 personalities** — Roast Master, Unhinged, Witty, Hype Man, Valley Girl,
  Robot and more, each with tuned prompt engineering
- **OpenCode Zen** provider — paste one key and get every model your account
  can access, including the free tier (Ox Alpha Free, Big Pickle, MiMo-V2.5,
  Hy3, Nemotron), plus Anthropic / OpenAI / Groq / Cerebras or a local
  LM Studio server
- **Global shortcuts** — trigger analysis hands-free from any app
- **Voice replies** — local Sherpa/Kokoro TTS or your own HTTP endpoint
- **Session history** — every analysis saved locally; markdown-rendered
  responses with section badges

## Prerequisites

- Node.js 20+
- Rust toolchain (`rustup`) with the MSVC target on Windows
- Tauri v2 system dependencies ([guide](https://tauri.app/start/prerequisites/))
- For GPU-accelerated transcription (optional): NVIDIA GPU + CUDA toolkit +
  CMake. The app's Settings → Capture panel tells you exactly what's missing
  and how to fix it.
- Screen capture via [screenpipe](https://screenpipe.com) is optional — the
  app can install it for you, but audio-only transcription works without it.

## Getting started

```bash
npm install

# Dev (Next.js dev server on http://127.0.0.1:43110 + Tauri shell)
npm run tauri dev

# Production build
npm run tauri build
```

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server bound to `127.0.0.1` only |
| `npm run tauri dev` | Full desktop app in dev mode |
| `npm run tauri build` | Production installer |
| `npm run typecheck` | Strict TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit tests |

## First-run setup

1. Launch the app; open **Settings → Capture**.
2. Transcription mode defaults to **Local (Free)** — works instantly with the
   bundled model, no keys required:
   - Pick your **engine**: Moonshine (recommended — download once, then enjoy
     near-instant transcriptions) or Whisper (choose a model from Tiny up to
     Large-v3-Turbo quantized).
   - NVIDIA GPU? Flip **Use GPU** on. If CUDA isn't detected, the info
     tooltip lists exactly what to install/configure.
3. Configure your input ("You") and output ("Them") audio devices.
4. Add an LLM provider key under **Settings → Providers** — OpenCode Zen gets
   you a whole catalog including free models — or point at a locally running
   LM Studio server.
5. Choose a personality + response style and start a session.

## Privacy model

- **Local-first by default**: on-device transcription (Whisper/Moonshine),
  nothing leaves your machine unless you explicitly switch to cloud
  transcription or enable vision uploads.
- Transcripts and session history stay **on your machine** (IndexedDB).
  Nothing is synced.
- Secrets never touch localStorage — they live in a Tauri-managed secure
  store, migrated automatically from older versions.
- All localhost API routes are loopback-only and reject cross-site requests;
  the Deepgram key (if you use cloud mode) is redacted from all logs.

See [docs/architecture.md](docs/architecture.md) for the security model and
LLM-provider architecture.

## Project structure

```
app/            Next.js routes (incl. guarded local-only API routes)
components/     React UI (dashboard, ai-response, settings, overlay)
hooks/          Feed, session history, shortcut hooks
lib/            Zustand stores, LLM providers, prompt builder, guards
src-tauri/      Rust backend: capture, Whisper/Moonshine engines, TTS
docs/           Architecture notes
```

Before changing LLM-related code, read [docs/architecture.md](docs/architecture.md) —
all provider traffic goes through one TS stack (`lib/llm-providers.ts` via
`/api/llm`); the legacy Rust LLM path was removed in 2026-08. The always-on-top
overlay window is a planned future feature, not yet wired up.
