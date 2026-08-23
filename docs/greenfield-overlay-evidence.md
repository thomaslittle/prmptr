# Greenfield Overlay Evidence

Branch: `feature/greenfield-speech-core`

This ledger distinguishes source implementation from runtime qualification. An implementation checkbox is not evidence that a compositor/window manager behaved correctly on physical hardware.

## Implemented

- Optional overlay defaults OFF in persisted frontend preferences.
- `tauri.conf.json` no longer creates an overlay window at application startup.
- Native `OverlayManager` dynamically owns create/show/hide/destroy/config/content state.
- Explicit OFF destroys the overlay WebView.
- Overlay is transparent, undecorated, resizable, always-on-top, and skipped from the taskbar.
- macOS enables Tauri `macos-private-api` only in the macOS target dependency because transparent native windows are feature-gated there.
- Desired capture protection defaults ON to reduce PRMPTR self-capture / OCR feedback risk.
- Effective capture protection is reported separately: Windows/macOS supported by this runtime path; Linux reported unsupported.
- Linux does not silently rewrite the portable desired shield preference to false merely because the current platform cannot enforce it.
- Click-through defaults OFF and is controlled from the main window even when the overlay itself cannot receive pointer events.
- Latest overlay payload is retained natively so renderer startup/reload cannot miss current response state.
- Overlay payload is bounded before IPC.
- `/overlay` renders real completed PRMPTR response history and active streaming content.
- `AiResponse` mirrors its existing local `currentResponse` and `isStreaming` into existing `SessionStore` setters while remaining the sole LLM stream owner.
- The live-stream bridge commit was audited as **15 additions / 0 deletions** in `components/ai-response.tsx`.
- Overlay appearance/history/auto-show/capture-shield preferences persist independently from API keys and speech settings.
- Auto-show is edge-triggered only by a new stream start or genuinely new completed response; token/config/appearance refreshes do not repeatedly force visibility.
- Restore after deterministic preview explicitly suppresses auto-show.
- Show/hide and click-through shortcuts are registered only while overlay is enabled.
- General PRMPTR shortcut management no longer calls `unregisterAll()`.
- Default Tauri capability no longer grants `global-shortcut:allow-unregister-all`.
- Shortcut collisions fail instead of intentionally stealing another subsystem's exact binding.
- Native move/resize events report window bounds back to the main frontend where platform coordinates are trustworthy.
- Wayland does not persist global x/y coordinates because compositor-global placement is not reliably available.
- A native Center/Recover command can recover a saved off-screen window after monitor-layout changes.
- External/user window destruction reconciles native/persisted enabled state.
- Native enable/config changes are transactional: rejected OS configuration does not become application truth.
- Runtime-state echoes preserve frontend preference object identity when nothing changed, preventing config/event loops.
- A deterministic **Test overlay** sequence exercises thinking, streaming text, completion, and restoration through the same native transport without speech or an LLM.
- Tune reports platform, visible/hidden, created/not-created, effective shield, click-through, and unsupported capability warnings.
- Focused TypeScript tests cover history bounds, empty filtering, appearance clamps, session/streaming payloads, default-off behavior, preference clamps, desired-vs-effective shield behavior, and native lifecycle/bounds merging.
- Rust unit coverage includes bounds/default invariants and edge-triggered auto-show semantics.
- `npm run overlay:guard` statically enforces the key optional-runtime invariants.
- `npm run overlay:ready:all` is the single local preflight for Greenfield guard + focused Vitest + TypeScript + Rust overlay tests + locked Cargo check.
- `docs/overlay-user-test-checklist.md` defines exact-SHA physical qualification.

## Source-level evidence

### Live token bridge

Commit:

- `ba091d04862cea0a4c95ce48ad386c279088e27e` — `Mirror active AI stream into shared session state`

GitHub compare against its parent showed:

- `components/ai-response.tsx`
- additions: 15
- deletions: 0

This is evidence that token sharing was added without rewriting the response component or introducing another request path. It is not, by itself, runtime proof that a provider stream rendered correctly.

### macOS transparency build requirement

Commit:

- `074c3a83588c083bc4dbf4084623879877fb8885` — `Enable macOS transparent overlay window support`

The feature is target-scoped in `src-tauri/Cargo.toml`. Mac App Store packaging remains a separate future concern because this Tauri feature uses private macOS API support for transparent windows.

## Local readiness commands

At the exact candidate SHA:

```bash
npm run overlay:ready
npm run overlay:ready:native
```

or:

```bash
npm run overlay:ready:all
```

These commands must only be marked PASS when genuinely executed at the retained SHA. They have **not** been marked PASS from the current connector-only execution environment.

## Runtime qualification — NOT TESTED

The following remain NOT TESTED until exact-SHA retained evidence is produced on the relevant platform.

### Windows

- dynamic create/destroy
- deterministic preview rendering
- real token-by-token stream rendering
- no duplicate LLM request during overlay use
- always-on-top behavior across common applications/games
- drag + resize + persisted bounds
- hide/show shortcut while another application is focused
- click-through and recovery from main window
- Center/Recover after stale monitor coordinates
- capture protection against PRMPTR native screenshot and Screenpipe OCR
- DPI / multi-monitor movement

### macOS

- successful build with the target-scoped transparent-window feature
- dynamic create/destroy
- deterministic preview and real token streaming
- always-on-top Spaces/full-screen behavior
- click-through
- content protection
- center/recovery and bounds persistence across Retina scaling / monitor changes

### Linux

- successful target build on supported distro/toolchain
- X11 and/or supported Wayland compositor behavior
- deterministic preview and real token streaming
- always-on-top support
- click-through support
- Center/Recover behavior
- X11 position persistence; Wayland intentionally does not claim reliable global-position persistence

Linux capture protection is **UNSUPPORTED by this Tauri window path**, and the application now reports that explicitly rather than leaving it as an ambiguous runtime test.

## User-test entry status

Source/architecture P0 and P1 overlay work is complete enough to begin user testing. The next authority is the runtime checklist:

- `docs/overlay-user-test-checklist.md`

A target platform should enter broader user testing only after `npm run overlay:ready:all` passes at the retained SHA and the deterministic preview succeeds on that machine. Physical compositor/capture/full-screen results must be recorded as PASS/FAIL/NOT TESTED rather than inferred from implementation.
