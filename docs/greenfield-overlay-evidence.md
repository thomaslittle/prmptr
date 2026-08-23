# Greenfield Overlay Evidence

Branch: `feature/greenfield-speech-core`

This ledger distinguishes source implementation from runtime qualification. An implementation checkbox is not evidence that a compositor/window manager behaved correctly on physical hardware.

## Implemented

- Optional overlay defaults OFF in persisted frontend preferences.
- `tauri.conf.json` no longer creates an overlay window at application startup.
- Native `OverlayManager` dynamically owns create/show/hide/destroy/config/content state.
- Explicit OFF destroys the overlay WebView.
- Overlay is transparent, undecorated, resizable, always-on-top, and skipped from the taskbar.
- Capture protection defaults ON to reduce PRMPTR self-capture / OCR feedback risk.
- Click-through defaults OFF and is controlled from the main window even when the overlay itself cannot receive pointer events.
- Latest overlay payload is retained natively so renderer startup/reload cannot miss the current completed response snapshot.
- Overlay payload is bounded before IPC.
- `/overlay` renders real completed PRMPTR response history through the existing Markdown renderer dependency.
- Overlay appearance/history/auto-show/capture-shield preferences persist independently from API keys and speech settings.
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
- Pure projection tests cover history bounds, empty filtering, appearance clamps, session ID, and streaming payload shape.
- `npm run overlay:guard` statically enforces the key optional-runtime invariants.
- Final source compare from the pre-overlay speech head contains only overlay/shortcut/capability/documentation surfaces; no speech-engine source files are changed by this overlay batch.

## Static evidence / guards

Run at the retained SHA:

```bash
npm run overlay:guard
npm test -- --run lib/__tests__/overlay.test.ts
npm run typecheck
```

Rust-capable qualification should additionally run:

```bash
cd src-tauri
cargo test overlay --locked
cargo check --locked
```

These commands must only be marked PASS when they are genuinely run at the retained commit SHA. They have **not** been marked PASS from the current connector-only execution environment.

## Runtime qualification — NOT TESTED

The following remain NOT TESTED until exact-SHA retained evidence is produced on the relevant platform:

### Windows

- dynamic create/destroy
- always-on-top behavior across common applications/games
- drag + resize + persisted bounds
- hide/show shortcut while another application is focused
- click-through and recovery from main window
- Center/Recover after stale monitor coordinates
- capture protection against PRMPTR native screenshot and Screenpipe OCR
- DPI / multi-monitor movement

### macOS

- dynamic create/destroy
- always-on-top Spaces/full-screen behavior
- click-through
- content protection
- center/recovery and bounds persistence across Retina scaling / monitor changes

### Linux

- X11 and/or supported Wayland compositor behavior
- always-on-top support
- click-through support
- content protection support
- Center/Recover behavior
- X11 position persistence; Wayland intentionally does not claim reliable global-position persistence

## Open P1 bridge

The overlay has no independent speech, LLM, TTS, or session loop. Completed AI response state is sourced from `SessionStore` and projected into the optional native window.

The canonical overlay payload also supports `currentResponse` and `isStreaming`, and `SessionStore` already defines those fields. However, the legacy `AiResponse` component still owns its active SSE token buffer in component-local React state. Therefore **token-by-token overlay rendering is not claimed complete yet**.

The intended bridge is deliberately small: mirror the existing local `currentResponse` and `isStreaming` values into their existing `SessionStore` setters. It must not create another LLM request or inference loop. A detached whole-file reconstruction was audited and rejected because it caused hundreds of unrelated changed lines for this tiny bridge; it was never advanced to the branch.

Do not describe token-by-token overlay rendering as PASS until that minimal shared-state bridge is safely landed and exercised at the retained SHA.
