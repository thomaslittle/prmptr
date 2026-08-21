# PRMPTR Architecture

Tauri v2 desktop app (Rust backend) + Next.js 16 / React 19 frontend served in a
webview. PRMPTR captures screen (OCR via screenpipe) and microphone/system audio,
transcribes it, and streams LLM-generated suggestions to an always-on-top overlay.

```
┌────────────────────────── Webview (Next.js) ──────────────────────────┐
│  app/page.tsx (dashboard)        app/overlay/ (overlay window)        │
│      │                                │                               │
│  components/dashboard.tsx        overlay consumes Rust event stream   │
│      ├── hooks/use-screenpipe          (onResponseStream)             │
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
│ /api/screen-frame   │    │  session/, llm/     — session cmds, dead*  │
│  All loopback-only  │    └────────────────────────────────────────────┘
│  (lib/api-guard.ts) │
└─────────────────────┘
```

## The two LLM paths (IMPORTANT — known duplication)

There are **two parallel stacks** for talking to LLM providers. They were left
in place deliberately (deferred consolidation decision, 2026-08):

| Path | Entry | Status |
|------|-------|--------|
| **TS path** | `lib/llm-providers.ts` via `POST /api/llm` | **Live/canonical.** Dashboard + ai-response use it. Supports anthropic/openai/groq/cerebras/lmstudio, SSE streaming, image input. |
| **Rust path** | `src-tauri/src/llm/*` via `trigger_llm` command → `response-stream` events | **Dead-ish.** No frontend callers except the overlay's event listener (`app/overlay`). Kept because the overlay currently renders its events. |

**Rules until this is consolidated:**
1. New providers/models/features go in the TS path only.
2. Prompt construction exists twice (`lib/prompt-builder.ts` and
   `src-tauri/src/llm/prompt_builder.rs`) — treat the TS one as canonical.
3. If you touch the overlay's data source, expect output-format drift vs
   `/api/llm`; see finding ARCH-02 in the audit.
4. Consolidation options when revisited: port overlay to the TS stream and
   delete `src-tauri/src/llm`, or move everything behind Tauri commands.

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
