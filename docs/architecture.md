# PRMPTR Architecture

Tauri v2 desktop app (Rust backend) + Next.js 16 / React 19 frontend served in a
webview. PRMPTR captures screen (OCR via screenpipe) and microphone/system audio,
transcribes it, and streams LLM-generated suggestions to an always-on-top overlay.

```
┌────────────────────────── Webview (Next.js) ──────────────────────────┐
│  app/page.tsx (dashboard)                                             │
│      │                                                                │
│  components/dashboard.tsx                                             │
│      ├── hooks/use-screenpipe                                         │
│      ├── hooks/use-local-transcription                                │
│      └── components/ai-response.tsx   ← streaming client, rate-limit  │
│                                         fallback, seen-item gating    │
│                                                                        │
│  lib/stores/settings-store.ts  ← non-secret settings → localStorage;   │
│                                   secrets → tauri-plugin-store file    │
│  lib/db.ts (Dexie)             ← sessions/responses/feed history       │
└──────┬─────────────────────────────┬──────────────────────────────────┘
       │ HTTP (localhost)            │ Tauri IPC
┌──────▼──────────────┐    ┌─────────▼──────────────────────────────────┐
│ Next.js API routes  │    │ src-tauri/src (Rust)                       │
│ /api/llm            │    │  commands.rs        — command entrypoints  │
│ /api/provider-models│    │  screenpipe/        — process mgmt+install │
│ /api/stream         │    │  transcription/     — whisper & deepgram   │
│ /api/screen-frame   │    │  session/           — session cmds         │
│  All loopback-only  │    └────────────────────────────────────────────┘
│  (lib/api-guard.ts) │
└─────────────────────┘
```

## LLM access (single path)

The Rust LLM stack (`src-tauri/src/llm/*`, `trigger_llm` command,
`response-stream` events) was **deleted in 2026-08** — it had no live callers.
All provider traffic goes through one path:

- **TS path**: `lib/llm-providers.ts` via `POST /api/llm` — supports
  anthropic/openai/groq/cerebras/lmstudio, SSE streaming, image input.
- `lib/prompt-builder.ts` is the only prompt builder (the Rust duplicate is gone).
- The two surviving Rust helpers `validate_api_key` / `fetch_lmstudio_models`
  are plain `reqwest` calls in `commands.rs`, kept for key-checking and LM
  Studio model listing from the settings UI.

## Overlay window (future feature — not wired up)

The always-on-top floating suggestion HUD (`app/overlay/`, `overlay` window in
`tauri.conf.json`: frameless, transparent, always-on-top, starts hidden) is the
original product vision: transcribe mic + system audio, show AI-suggested
replies over whatever app you're using.

**Current state:** unreachable. No code shows/toggles the window (the
"Ctrl+Shift+H to toggle" hint on the page has no handler behind it), and its
only data source (`response-stream`) was removed with the Rust LLM path. The
page currently renders as an empty shell if ever shown.

**To revive it (planned):**
1. Register a global shortcut to show/hide the window (and click-through
   toggle).
2. Port the page to consume the TS `/api/llm` stream instead of the deleted
   Rust events.
3. Decide what triggers requests for the overlay (session auto-mode, hotkey
   ask, etc.).

## Security model

- **API routes** are local dev-server endpoints reachable by any local
  process. `lib/api-guard.ts` rejects non-loopback Hosts and cross-site
  origins; all user-supplied URLs must be loopback http(s)
  (`parseLocalHttpUrl`). Do not add routes that fetch arbitrary URLs.
- **Secrets** (provider keys, Deepgram key, TTS key) never touch localStorage.
  They live in a tauri-plugin-store file (`settings-secrets.json`) and are
  merged into runtime state at startup (`lib/stores/settings-store.ts`).
- **Tauri config**: strict CSP in `tauri.conf.json`; `withGlobalTauri: false`;
  `open_external_url` allows http(s) only; downloads have size caps; the
  Deepgram key is redacted from logs/argv (`ScreenpipeManager::redact_args`).

## Verification gates

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (zero errors policy)
npm test            # vitest
cargo check         # run inside src-tauri/
npx react-doctor@latest --scope changed   # advisory
```
