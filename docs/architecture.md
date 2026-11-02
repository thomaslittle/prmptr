# PRMPTR Architecture

Tauri 2 desktop app. The UI is a **Next.js 16 static export** (`out/`) served
from the app bundle; there is no Node server at runtime. Native work lives in
the Rust backend and is reached through narrow Tauri commands.

```
┌──────────────────────── Webview (static Next.js export) ───────────────────────┐
│ components/dashboard ── feed (local-transcription events)                      │
│                     └── ai-response ── lib/llm-client ──┬─ lib/llm-providers   │
│                                                         │   (Anthropic, OpenAI,│
│                                                         │    Groq, Cerebras,   │
│                                                         │    Zen, LM Studio)   │
│                                                         └─ local_ai_* commands │
│ lib/http.ts → @tauri-apps/plugin-http (Rust HTTP, allowlisted hosts only)      │
│ lib/stores (zustand; secrets → tauri-plugin-store), lib/db (Dexie history)     │
└───────────────┬─────────────────────────────────────────────┬──────────────────┘
                │ Tauri IPC                                    │ HTTPS (plugin-http)
┌───────────────▼──────────────────────────────────┐   provider APIs / loopback
│ src-tauri/src                                     │
│  transcription/local_stream  cpal capture (mic +  │
│     WASAPI loopback) → vad (Silero v6.2) →        │
│     stt_engine (transcribe.cpp: Parakeet, …)      │
│  transcription/deepgram_stream  cloud option      │
│  transcription/model_manager  pinned GGUF catalog │
│  local_ai   OriginLM (Claude Code, Codex, …)      │
│  screenshot xcap capture for vision models        │
│  commands   TTS (sherpa Kokoro / HTTP), keys, …   │
└───────────────────────────────────────────────────┘
```

## Speech pipeline

1. **Capture** — `cpal` 0.18 streams the microphone ("You") and the system
   output ("Them"): WASAPI loopback on Windows, and the PulseAudio/PipeWire
   monitor source via `parec` on Linux (the monitor is captured by name, so it
   follows the default sink). `transcription/conditioner.rs` downmixes any
   channel count (6–8 channel loopback devices included) and resamples to
   16 kHz with rubato's band-limited FFT resampler — energy above 8 kHz is
   filtered rather than aliased into the speech band. Shared by local and
   Deepgram capture. Per-channel mute is a live soft-mute.
2. **VAD** — `transcription/vad.rs` feeds Silero VAD v6.2 (GGUF, bundled,
   1.2 MB) through transcribe.cpp and segments utterances with hysteresis
   (start ≥ 0.45, end after 300 ms < 0.30, 200 ms minimum, 10 s cap). Silence
   never reaches the ASR model, which is what prevents "Thank you." style
   hallucinations. The segmenter is a pure state machine with unit tests.
3. **ASR** — `transcription/stt_engine.rs` runs one transcribe.cpp session for
   both channels. Default model: **Parakeet Unified English** (Q8_0). Others:
   Parakeet v3 (multilingual), Whisper Large v3 Turbo, Moonshine Small,
   Parakeet 110M. Utterances get 300 ms of trailing silence (transducers emit
   the last word only after seeing audio past it); outputs are cleaned of known
   non-speech hallucinations.
3b. **Glossary** — one entry per line, `Term` or `Term = mishearing, …`
   (`lib/glossary.ts`, sent on Start). Parakeet biases decoding toward the
   terms (Parakeet vocabulary rescoring from the transcribe.cpp fork hex uses,
   pinned in `Cargo.toml`); Whisper reads them as a context prompt; listed
   mishearings are rewritten to the term as whole words for every model.
   Suggestions get the terms in their system prompt.
4. **Models** — `model_manager.rs` pins each model to a Hugging Face commit +
   SHA-256. Downloads stream to `<file>.part`, are hashed, then renamed into
   place; a size-mismatched file is never treated as installed. Legacy
   whisper.cpp / Moonshine-ONNX files from older versions are removed at start.
5. **Events** — finals are emitted as `local-transcription`; a dead worker
   emits `local-transcription-status` so the UI leaves its running state.

GPU: the default build is CPU-only (Parakeet is >15× real time on a desktop
CPU). `--features vulkan` (needs the Vulkan SDK) or `--features cuda` enable GPU
backends; `prefer_gpu` then lets transcribe.cpp pick the device, falling back to
CPU.

## LLM access

- **API providers** — `lib/llm-providers.ts` streams SSE from each provider via
  `appFetch` (Tauri's Rust HTTP client; no CORS, host allowlist in
  `capabilities/default.json`). Current-model semantics: Claude 4.6+/5.x get no
  `temperature` and `output_config.effort: "low"` plus thinking headroom in
  `max_tokens`; OpenAI GPT-5+/o-series get `max_completion_tokens` and
  `reasoning_effort: "low"`. A 429 on Groq or Cerebras fails over to the other.
- **Your AI apps** — `src-tauri/src/local_ai.rs` embeds `originlm-kit`.
  Discovery and metadata probes list models from the user's installed clients;
  only connections OriginLM has verified as authenticated (or accountless local
  runtimes) are offered. Each completion is a fresh read-only session (no
  writes, no native tools, never paid fallback) whose text deltas stream to the
  webview over a Tauri `Channel`. PRMPTR never sees subscription credentials.
  Claude Code subscriptions are only ever used *through Claude Code*, which is
  what Anthropic's terms allow. Discovery is host-owned: PRMPTR hands OriginLM
  the native executable behind OpenCode's npm shim (`node_modules/@opencode/cli`)
  so the adapter can read that client's live catalog, and sets `HOME` from
  `USERPROFILE` on Windows for the same reason (the adapter resolves OpenCode's
  service descriptor from `HOME`). Discovery runs from a host-owned inventory
  source so OpenCode's npm shim is resolved to the native `@opencode/cli`
  binary (OriginLM probes only native executables); Windows also mirrors
  `USERPROFILE` to `HOME`, which OpenCode's service descriptor lookup reads.
- `lib/prompt-builder.ts` is the only prompt builder.

## Overlay

An optional, opt-in always-on-top window (`src-tauri/src/overlay/mod.rs`,
`components/overlay-feature-controller.tsx`, `app/overlay/page.tsx`), ported
from `feature/greenfield-speech-core`.

- Created on demand (not declared in `tauri.conf.json`); destroyed when turned
  off. Hidden from screen capture by default (`content_protected`), with
  click-through, show/hide, center/recover, opacity, text size and history depth.
- **One LLM stream:** `ai-response.tsx` mirrors its streaming state into the
  session store; the controller publishes that projection to the overlay. The
  overlay never issues its own request.
- Global shortcuts: `Ctrl+Shift+H` show/hide, `Ctrl+Shift+C` click-through.
  The shortcut manager only unregisters shortcuts it owns, so the two
  subsystems never clobber each other.
- Windows/WebView2 invariants (each was a reproduced hang):
  never hold the overlay state lock across a window call (`is_visible()`
  round-trips to the main thread, which takes the same lock in window-event
  handlers); create the overlay with the main window's browser arguments
  (WebView2 requires one environment per process); delay the startup sync
  400 ms and never let it undo a user toggle; clear capture protection before
  destroying; never emit into the overlay during its own teardown.

## Security model

- The webview can only reach the HTTP hosts allowlisted for `plugin-http`
  (provider APIs + loopback for LM Studio). LM Studio URLs must be loopback.
- Secrets (API keys, Deepgram, TTS) live in a `tauri-plugin-store` file and
  are merged into memory at startup; they never touch localStorage. Legacy
  plaintext keys are migrated and scrubbed on first launch.
- Strict CSP; `withGlobalTauri: false`; `open_external_url` allows http(s)
  only; model downloads are size- and hash-checked.

## Native runtime libraries

One C runtime per process: the dynamic release CRT (`/MD`), matching the
prebuilt sherpa-onnx / ONNX Runtime DLLs. `.cargo/config.toml` pins CMake
builds (transcribe.cpp) to it and dev build scripts don't inject the debug CRT.
`beforeBuildCommand`/`npm run tauri:build` runs `scripts/stage-native-libs.mjs`,
which stages the sherpa/ONNX runtime for the host and writes a small generated
`tauri.bundle.local.conf.json` for the package:

- Windows: the DLLs and the VC++ runtime, app-local next to `prmptr.exe`
  (`runtime-dlls/`).
- Linux: the shared libraries, packaged at `/usr/lib/PRMPTR` and found through
  the executable RUNPATH `$ORIGIN/../lib/PRMPTR` set in `.cargo/config.toml`.

This is why the RPM/DEB start on a clean machine without a separate sherpa or
ONNX Runtime install.

## Verification

| Layer | Command |
|---|---|
| Types / lint / unit | `npm run typecheck`, `npm run lint`, `npm test` |
| UI end-to-end (production bundle, faked Rust) | `npm run build && npm run test:e2e` |
| Rust unit | `npm run test:rust` |
| Real speech pipeline | `PRMPTR_TEST_MODELS=<dir> cargo test --test real_audio` |
| Real desktop app | build with `e2e/support/tauri.cdp.conf.json`, launch, `node e2e/real-app/smoke.mjs` |
