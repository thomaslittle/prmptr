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
- `/overlay` renders real PRMPTR response history through the existing Markdown renderer dependency.
- Overlay appearance/history/auto-show/capture-shield preferences persist independently from API keys and speech settings.
- Show/hide and click-through shortcuts are registered only while overlay is enabled.
- General PRMPTR shortcut management no longer calls `unregisterAll()`.
- Shortcut collisions fail instead of intentionally stealing another subsystem's exact binding.
- Native move/resize events report window bounds back to the main frontend for persistence.
- Pure projection tests cover history bounds, empty filtering, appearance clamps, session ID, and streaming payload shape.
- `npm run overlay:guard` statically enforces the key optional-runtime invariants.

## Static evidence / guards

Run:

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

These commands must only be marked PASS when they are genuinely run at the retained commit SHA.

## Runtime qualification — NOT TESTED

The following remain NOT TESTED until exact-SHA retained evidence is produced on the relevant platform:

### Windows

- dynamic create/destroy
- always-on-top behavior across common applications/games
- drag + resize + persisted bounds
- hide/show shortcut while another application is focused
- click-through and recovery from main window
- capture protection against PRMPTR native screenshot and Screenpipe OCR
- DPI / multi-monitor movement

### macOS

- dynamic create/destroy
- always-on-top Spaces/full-screen behavior
- click-through
- content protection
- bounds persistence across Retina scaling / monitor changes

### Linux

- X11 and/or supported Wayland compositor behavior
- always-on-top support
- click-through support
- content protection support
- position persistence (Wayland does not expose reliable global coordinates on every compositor)

## Open qualification note

The overlay has no independent speech, LLM, TTS, or session loop. Completed AI response state is sourced from `SessionStore` and projected into the optional native window. The store already defines live-stream fields (`currentResponse`, `isStreaming`); exact token-by-token mirroring from the current `AiResponse` component must be verified during frontend qualification because that component historically kept its streaming buffer locally.

Do not describe token-by-token overlay rendering as PASS until the live shared-state bridge is exercised or explicitly connected at the retained SHA.
