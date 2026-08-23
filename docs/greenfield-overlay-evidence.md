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

## Runtime qualification — Windows 11 (automated, exact SHA)

Automated desktop qualification was executed on Windows 11 (multi-monitor: 2560x1440 primary + 1080x1920 portrait + 2x 1920x1080) against the exact SHAs below, driving the app through its real Tauri IPC surface (mcp-bridge debug plugin + Win32 window inspection + SendInput global chords + GDI screen capture). WebView2 runtime 151.0.4129.101.

### At `371c602` — gate repairs

- `npm run overlay:guard` PASS
- focused overlay Vitest (8 tests) PASS
- `tsc --noEmit` PASS (after fixing `live-feed.tsx` null-narrowing)
- `cargo test overlay --locked` PASS (3 tests; after fixing pre-existing duplicate moonshine commands, non-Result async command, use-after-move in capture timeout path, feature-gated test)
- `npm test` PASS (85 tests; after adding `vitest.config.ts` with `@` alias + scoping discovery to `lib/__tests__`)
- `npm run lint` PASS (after ignoring `src-tauri/**` build output, ESM-converting three `scripts/*.js` utilities, deferring a sync setState in the overlay controller)
- `npm run build` PASS (production Next build, `/overlay` route emitted)

### At `4f122ce` — overlay disable deadlock fix

Defect (P0, reproduced 100% on clean state): `set_overlay_enabled(false)` deadlocked the main thread whenever the overlay was content-protected. Destroying a `WDA_EXCLUDEFROMCAPTURE` WebView2 hangs in DWM/WebView2 teardown. Fix: clear content protection before destroying, destroy off the invoke stack, and never emit runtime events into the overlay webview during its own destruction.

Runtime evidence at this SHA:

- enable (shield ON): window created, visible, `WS_EX_TOPMOST`, display affinity `0x11` — PASS
- disable (shield ON): window destroyed (hwnd gone), app responsive — PASS (was: permanent hang before fix)
- external `WM_CLOSE` on overlay: window destroyed, main reconciles, re-enable creates one clean window — PASS
- rapid token burst (25 publishes @ ~50ms), 8-item Markdown history with code/bullets/headings, opacity 0.45/0.7/1.0 and font scale 0.8/1.0/1.5: no clipping, no runaway growth, app responsive — PASS
- 4x repeated enable/disable: stable, no create/destroy loop — PASS
- auto-show semantics: appearance/config changes and mid-stream token updates while hidden do NOT reopen; a genuinely new stream or new completed response auto-shows exactly once — PASS
- click-through: `WS_EX_TRANSPARENT` set/cleared; `WindowFromPoint` at overlay center hits the window beneath while pass-through and the overlay's own WebView child when interactive; recoverable from main window — PASS
- global shortcuts while another application (Notepad) held focus: `Ctrl+Shift+H` toggled visibility both directions; `Ctrl+Shift+C` toggled click-through both directions; after disable, chords no longer affect anything (registrations released) — PASS
- capture shield (empirical, not inferred): GDI `CopyFromScreen` of the overlay region with shield ON excludes the overlay (underlying apps visible); with shield OFF the same capture shows the overlay's unique marker text; display affinity toggles live `0x11`↔`0x0` — PASS
- graceful-close restart persistence: bounds (300,250 500x400) and enabled state restored exactly — PASS
- cross-monitor: gradual 20-step drag across monitor boundary with shield ON — PASS; Center/Recover from secondary monitor — PASS

Known limitation (P2, documented, not fixed): an ATOMIC cross-monitor move+resize jump (single `SetWindowPos` changing position and size simultaneously across a DPI boundary) with the shield enabled can deadlock the main thread. Real pointer drags (gradual moves) are unaffected. This is a WebView2/DWM behavior outside PRMPTR's control; the practical user path is safe.

### At `56e59cd` — startup race fixes

Defect (P0, reproduced): with overlay enabled in persisted preferences, application startup auto-restore could deadlock the main thread (majority of boots) and React StrictMode's double-invoked init effect could race two concurrent window builds into an orphaned native window. Fix: serialize overlay window creation behind a manager lock, and defer the controller's initial ownership sync 400ms so the overlay never races the main window's own WebView2 startup burst.

Runtime evidence at this SHA:

- 4/4 boots with overlay enabled: app responsive, exactly one overlay window, topmost, shield `0x11` — PASS (before fix: hang on most boots)
- 3/3 boots with overlay disabled: no overlay window, app responsive — PASS
- deterministic self-test through the real transport (thinking → streamed partial → completed Markdown with bold/bullets/code → restore): rendered progression verified by per-stage overlay screenshots — PASS
- final smoke (enable → stream stage → complete → disable): window destroyed, app responsive — PASS

### Still NOT TESTED on Windows

- real token-by-token LLM stream mirrored into the overlay (provider key configured, but no automatable feed-data source in this environment; the projection path itself is proven by the persisted-session mirror at startup and the deterministic self-test)
- no-duplicate-LLM-request observation during a real stream (same blocker; the Greenfield guard statically forbids any overlay LLM path and the live bridge is a 15-line mirror)
- mixed-DPI monitors at different scale factors (all attached displays share one scale)
- full-screen/game-mode always-on-top behavior
- Screenpipe OCR round-trip (Screenpipe not running in this environment; GDI exclusion proven directly)
- macOS and Linux: everything (untouched on this machine)

## Runtime qualification — macOS — NOT TESTED

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

Windows has completed automated exact-SHA qualification through the checklist's automatable surface (default-off, dynamic create/destroy, deterministic preview, show/hide, auto-show semantics, click-through + recovery, Center/Recover, move/resize/persistence, shortcut isolation, empirical capture shield, restart persistence, stress content) with two P0 deadlocks found and fixed. Real-LLM mirroring on Windows remains NOT TESTED pending a feed-data source, and macOS/Linux remain NOT TESTED.

Source/architecture P0 and P1 overlay work is complete enough to begin user testing. The next authority is the runtime checklist:

- `docs/overlay-user-test-checklist.md`

A target platform should enter broader user testing only after `npm run overlay:ready:all` passes at the retained SHA and the deterministic preview succeeds on that machine. Physical compositor/capture/full-screen results must be recorded as PASS/FAIL/NOT TESTED rather than inferred from implementation.
