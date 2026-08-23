# Greenfield Overlay System Goal

## Goal

Build PRMPTR's always-on-top response overlay as a first-class, optional desktop subsystem that can be enabled without changing the speech/LLM pipeline and disabled with zero overlay-window runtime cost.

The overlay is a **consumer of canonical PRMPTR state**, never a second inference loop. It renders the same completed and token-by-token active AI response state already owned by the dashboard/session pipeline.

## Product contract

- Overlay is **OFF by default**.
- OFF means the overlay WebView does not exist.
- ON dynamically creates one transparent always-on-top window.
- Disabling destroys that window rather than merely hiding it.
- The overlay never starts transcription, Screenpipe, an LLM request, TTS, or another session.
- Capture shield is desired ON by default and reported separately from whether the current platform can actually enforce it.
- Windows/macOS expose capture protection as supported; Linux reports it unsupported instead of pretending it is active.
- Overlay can be hidden without disabling the feature; genuinely new response activity may auto-show it when configured.
- Token updates, appearance changes, and state restoration are not independently eligible to force a hidden overlay open.
- Click-through is explicit, reversible from the main window, and OFF by default.
- Window size/position, appearance, click-through, auto-show behavior, and feature enablement are persisted by the main UI.
- Global overlay shortcuts must not unregister or interfere with existing PRMPTR shortcuts.
- Shortcut collisions fail visibly rather than stealing another subsystem's binding.
- Saved off-screen bounds can be recovered from the main window with a native Center action.
- Linux Wayland does not pretend global window coordinates are reliable.

## Architecture

```text
AiResponse (single LLM stream owner)
          |
          | mirrors currentResponse/isStreaming
          v
SessionStore / response state
          |
          v
OverlayFeatureController (main WebView)
  - persists user preferences
  - publishes bounded response snapshots
  - owns overlay shortcuts while enabled
  - exposes deterministic Test overlay path
  - syncs native runtime state without config-event echo loops
          |
          v
Tauri OverlayManager
  - enabled/runtime truth
  - dynamic WebviewWindow create/destroy
  - effective platform capabilities
  - always-on-top / click-through / capture protection
  - edge-triggered auto-show
  - hide/show/center lifecycle
  - remembers latest payload for late window loads
          |
          v
/overlay WebView
  - rendering only
  - no inference/capture ownership
  - initializes from native snapshot
  - subscribes to overlay-content/runtime events
```

## Canonical overlay payload

```ts
interface OverlayContent {
  responses: Array<{
    id: string;
    content: string;
    timestamp: string;
    model: string;
    kind?: "analysis" | "chat";
  }>;
  currentResponse: string;
  isStreaming: boolean;
  sessionId?: string;
  appearance: {
    opacity: number;
    fontScale: number;
  };
}
```

The main window bounds history before publishing. The native manager stores the newest payload so creating/reloading the overlay cannot miss current response state.

## P0 — correctness and ownership

- [x] Dynamic overlay window instead of startup-created hidden WebView.
- [x] Default OFF optional feature contract.
- [x] Native overlay lifecycle manager.
- [x] Always-on-top undecorated transparent desktop window.
- [x] macOS transparent-window build feature enabled only on macOS.
- [x] Desired capture protection default ON with truthful effective capability reporting.
- [x] Click-through default OFF.
- [x] Native response snapshot + event transport.
- [x] Overlay route renders real completed PRMPTR responses.
- [x] Token-by-token active AI stream mirrors into the existing shared SessionStore fields.
- [x] No duplicate speech/LLM/session ownership.
- [x] Main-window control can recover from click-through mode.
- [x] Bounds are reported by native window events where global position is trustworthy.
- [x] External/user window destruction reconciles persisted enabled state.
- [x] Native enable/config state changes are transactional.
- [x] Disabled visibility/click-through commands cannot implicitly enable the overlay.

## P1 — usability

- [x] Persist overlay enablement/config independently from general secrets/settings.
- [x] Auto-show only on genuinely new response activity.
- [x] Show/hide without disabling.
- [x] Global show/hide shortcut while enabled.
- [x] Global click-through shortcut while enabled.
- [x] Shortcut registration coexists with PRMPTR's existing global shortcuts.
- [x] Removed `unregisterAll` use and authority from application capability policy.
- [x] Persist opacity/font scale/history count.
- [x] Compact main-window overlay control.
- [x] Bounded response history in overlay.
- [x] Center/recover action for stale multi-monitor coordinates.
- [x] Runtime/store synchronization prevents config-event echo loops.
- [x] Desired capture-shield preference stays portable when the current platform cannot enforce it.
- [x] Deterministic **Test overlay** sequence exercises thinking, streaming, completion, and restore without an LLM or microphone.
- [x] Preview restore explicitly suppresses auto-show so it respects a tester who hides the window.
- [x] Tune panel reports platform, visibility, window existence, effective shield, click-through, and unsupported capability warnings.

The token-stream bridge landed as a mechanically audited edit to `components/ai-response.tsx`: **15 additions, 0 deletions**. `AiResponse` remains the sole LLM stream owner; the overlay only observes its existing state.

## P2 — qualification / polish

Implementation is ready to enter user testing. These items intentionally require exact-SHA physical/runtime evidence and are not source-code completion claims:

- [ ] Exact-SHA Windows runtime evidence: create, preview, live stream, show, drag, resize, hide, click-through, center, destroy.
- [ ] Exact-SHA macOS runtime evidence for transparency, always-on-top, click-through, and capture protection.
- [ ] Exact-SHA Linux runtime evidence under supported X11/Wayland compositor behavior.
- [ ] Multi-monitor unplug/replug bounds recovery evidence.
- [ ] Verify capture-protection behavior against PRMPTR's screenshot/Screenpipe path on Windows/macOS.
- [ ] Accessibility/contrast review at supported opacity/font scales.
- [ ] Full-screen/game-specific always-on-top compatibility matrix for target user workflows.

P2 items remain **NOT TESTED** until retained exact-SHA evidence exists. Linux capture protection is currently reported **UNSUPPORTED**, not NOT TESTED/PASS.

## Failure behavior

- Window creation failure leaves the main app usable and does not commit `enabled=true`.
- Click-through/capture configuration failures do not commit rejected native state.
- Publishing content while disabled creates no overlay WebView/process resources.
- Overlay reload/open obtains the retained native snapshot before waiting for future events.
- A hidden overlay remains enabled; explicit Off destroys it.
- Visibility/click-through commands cannot implicitly enable a disabled overlay.
- Shortcut collisions report an error instead of unregistering an unknown owner.
- Preview cancellation/disable does not leave synthetic content as session truth.
- Preview restoration cannot force a user-hidden window open.
- Overlay data is local application state only and creates no network request by itself.

## Readiness gates

Frontend/source readiness:

```bash
npm run overlay:ready
```

Native readiness:

```bash
npm run overlay:ready:native
```

Combined:

```bash
npm run overlay:ready:all
```

The combined gate performs the overlay Greenfield source guard, focused Vitest coverage, TypeScript checking, Rust overlay tests, and locked Cargo check.

Manual runtime qualification is defined in:

- `docs/overlay-user-test-checklist.md`

## Greenfield implementation completion definition

The overlay is implementation-complete for entry into user testing when:

1. the static overlay declaration is absent from `tauri.conf.json`;
2. the optional runtime is dynamically owned by `OverlayManager`;
3. completed and active token-stream dashboard state are projected into a bounded overlay payload;
4. `/overlay` renders that payload and no placeholder copy remains;
5. enable/show/hide/center/click-through controls work through one native contract;
6. overlay shortcuts do not call `unregisterAll` or disturb existing shortcuts;
7. desired vs effective capture protection is represented truthfully;
8. tests/guards cover payload bounds, preferences, capability invariants, auto-show semantics, and architectural ownership;
9. deterministic preview is available before testing real speech/LLM flows;
10. no duplicate LLM request exists for overlay rendering;
11. platform runtime claims remain NOT TESTED until physical evidence exists.

All eleven source/architecture conditions are now implemented. User testing should begin by running the readiness gate and then the exact-SHA checklist; any failing runtime item becomes the next defect rather than being pre-declared PASS.
