# Greenfield Speech P1 Evidence Ledger

Updated: 2026-08-22  
Branch: `feature/greenfield-speech-core`

This ledger records implementation state separately from runtime qualification. A feature is not considered cross-platform PASS merely because code exists.

## Moonshine Voice streaming batch

| Area | State | Evidence |
| --- | --- | --- |
| Exact wrapper source | IMPLEMENTED | `moonshine-rs` pinned to `887c89f641d9bf8469099aa1e1f21c65ed72d24d` behind `moonshine-voice` feature. |
| Streaming architecture | IMPLEMENTED | Tiny/Small/Medium Streaming supported; Medium Streaming is default quality target. |
| Speculative decoding | IMPLEMENTED | Enabled in native transcriber options. |
| Independent mic/system streams | IMPLEMENTED | One owned Moonshine stream per enabled capture track, sharing the loaded transcriber. |
| Stable native line revisions | IMPLEMENTED | Native line ID + content/word/speaker fingerprint drives canonical revision increments. |
| Word timestamps/confidence | IMPLEMENTED | Native Moonshine words map into canonical `TranscriptWord`. |
| Native diarization spans | IMPLEMENTED | System-track spans map to stable `system:<speaker_id>` keys and canonical speaker spans. |
| JS-safe span indices | IMPLEMENTED | Upstream UTF-8 byte offsets are converted to UTF-16 indices at the Rust IPC boundary. |
| Default-on diarization | IMPLEMENTED | Existing preference remains default-on; native diarization is enabled at stream construction when system capture is active. |
| Diarization opt-out before start | IMPLEMENTED | Native diarization compute is disabled if speaker separation is off when the stream starts. |
| Live context | IMPLEMENTED | Runtime `set_context` control updates the live transcriber without reload. |
| Live keyterms | IMPLEMENTED | Runtime `set_keyterms` control updates the live transcriber without reload. |
| Context ranking | IMPLEMENTED | Session/OCR text produces bounded ranked proper-noun/identifier/technical terms; recognized audio text is excluded. |
| Model download integrity | IMPLEMENTED | Official dependency manifests are enforced with declared size + CRC32C and atomic `.part` replacement. |
| Diarization asset integrity | IMPLEMENTED | `segmentation.ort` + `embedding.ort` use the same verified installer rather than wrapper auto-cache. |
| Offline deep verify | IMPLEMENTED | `verify_moonshine_voice_model` recomputes official size/CRC32C manifests against installed files. |
| Existing Moonshine UI compatibility | IMPLEMENTED | Existing install/status command names route to verified Medium Streaming assets in feature builds. |
| Feature-off compatibility | IMPLEMENTED | Existing sherpa Moonshine installer/engine remains available when `moonshine-voice` is not compiled. |
| Unified diagnostics retained | IMPLEMENTED | Local + Deepgram audio pipeline counters remain present alongside Moonshine support/model status. |

## Qualification still open

| Gate | State | Required evidence |
| --- | --- | --- |
| `Cargo.lock` includes feature deps | **OPEN / FAILING** | Regenerate lockfile with `moonshine-rs`, `moonshine-sys`, `crc32c` and exact wrapper revision. `node scripts/check-moonshine-lock.mjs` must PASS. |
| Default Rust build | **NOT TESTED** | `cargo check` / app build on a Rust-capable machine. |
| `moonshine-voice` feature build | **NOT TESTED** | Exact-SHA feature build with native Moonshine/ORT linkage retained. |
| Rust tests | **NOT TESTED** | Run speech/model/stream tests; retain output. |
| TypeScript typecheck/tests | **NOT TESTED in this agent environment** | Run `npm run typecheck` + `npm test`; retain output. |
| Windows runtime | **NOT TESTED** | Real mic/system capture, model load, incremental transcript, diarization, context update, stop/restart. |
| macOS runtime | **NOT TESTED** | Same, including ScreenCaptureKit permission/system-audio proof. |
| Linux runtime | **NOT TESTED** | Same, including PipeWire/Pulse monitor-source proof. |
| Accuracy qualification | **NOT TESTED** | Real retained corpus through benchmark regression gate; fixture-only numbers do not count. |
| Live diarization compute toggle | **PARTIAL** | Turning separation off hides spans immediately; native compute is guaranteed off when disabled before stream start. Live compute reconfiguration without restart remains open. |
| Native build artifact determinism | **OPEN** | `moonshine-sys` still obtains upstream native release assets during build when no local Moonshine source is provided. Retained checksums/vendor strategy required before release qualification. |

## Commands

```bash
node scripts/check-moonshine-lock.mjs
npm run speech:benchmark -- --baseline <baseline.json> --candidate <candidate.json>
# On a Rust-capable qualification machine:
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features moonshine-voice
```

Do not promote Moonshine Voice to cross-platform PASS until the open qualification rows have retained exact-SHA evidence.
