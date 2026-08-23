# Greenfield Overlay System Goal

## Goal

Build PRMPTR's always-on-top response overlay as a first-class, optional desktop subsystem that can be enabled without changing the speech/LLM pipeline and disabled with zero overlay-window runtime cost.

The overlay is a **consumer of canonical PRMPTR state**, never a second inference loop. It displays the same finished AI responses the dashboard already owns and has a canonical slot for the active streaming response once the legacy response component mirrors that local buffer into shared state.

## Product contract

- Overlay is **OFF by default**.
- OFF means the overlay WebView does not exist.
- ON dynamically creates one transparent always-on-top window.
- Disabling destroys that window rather than merely hiding it.
- The overlay never starts transcription, Screenpipe, an LLM request, TTS, or another session.
- Overlay content is capture-protected by default so Screenpipe/screenshot context cannot feed PRMPTR's own suggestions back into context.
- Overlay can be hidden without disabling the feature; a later response may auto-show it when configured.
- Click-through is explicit, reversible from the main window, and OFF by default.
- Window size/position, appearance, click-through, auto-show behavior, and feature enablement are persisted by the main UI.
- Global overlay shortcuts must not unregister or interfere with existing PRMPTR shortcuts.
- Shortcut collisions fail visibly rather than stealing another subsystem's binding.
- Saved off-screen bounds can be recovered from the main window with a native Center action.
- Linux Wayland does not pretend globally positioned coordinates are reliable.

## Architecture

```text
SessionStore / response state
          |
          v
OverlayFeatureController (main WebView)
  - persists user preferences
  - publishes bounded response snapshots
  - owns overlay shortcuts while enabled
  - syncs native runtime state without config-event echo loops
          |
          v
Tauri OverlayManager
  - enabled/runtime truth
  - dynamic WebviewWindow create/destroy
  - always-on-top / click-through / capture protection
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

The main window bounds history before publishing. The native manager stores the newest complete payload so creating/reloading the overlay cannot miss the current completed-response snapshot.

## P0 — correctness and ownership

- [x] Dynamic overlay window instead of startup-created hidden WebView.
- [x] Default OFF optional feature contract.
- [x] Native overlay lifecycle manager.
- [x] Always-on-top undecorated transparent desktop window.
- [x] Capture protection default ON.
- [x] Click-through default OFF.
- [x] Native response snapshot + event transport.
- [x] Overlay route renders real completed PRMPTR responses.
- [x] Canonical overlay payload supports active streaming response state.
- [x] No duplicate speech/LLM/session ownership.
- [x] Main-window control can recover from click-through mode.
- [x] Bounds are reported by native window events where global position is trustworthy.
- [x] External/user window destruction reconciles the persisted enabled state.
- [x] Native enable/config state changes are transactional.

## P1 — usability

- [x] Persist overlay enablement/config independently from general secrets/settings.
- [x] Auto-show on new response option.
- [x] Show/hide without disabling.
- [x] Global show/hide shortcut while enabled.
- [x] Global click-through shortcut while enabled.
- [x] Shortcut registration coexists with PRMPTR's existing global shortcuts.
- [x] Removed `unregisterAll` authority from application capability policy.
- [x] Persist opacity/font scale/history count.
- [x] Compact main-window overlay control.
- [x] Bounded response history in overlay.
- [x] Center/recover action for stale multi-monitor coordinates.
- [x] Runtime/store synchronization prevents config-event echo loops.
- [ ] Mirror the legacy `AiResponse` component-local `currentResponse`/`isStreaming` state into the already-existing shared `SessionStore` fields so token-by-token overlay rendering uses the same single LLM stream.

The final unchecked P1 item is deliberately narrow. It requires only mirroring the existing component-local stream state into `SessionStore`; it must **not** create another LLM request. A detached whole-file reconstruction was rejected because it produced hundreds of unrelated changed lines for a three-effect bridge. Land this only through a mechanically safe targeted edit or after the component is cleanly split.

## P2 — qualification / polish

- [ ] Exact-SHA Windows runtime evidence: create, show, drag, resize, hide, click-through, center, destroy.
- [ ] Exact-SHA macOS runtime evidence for always-on-top/capture protection behavior.
- [ ] Exact-SHA Linux runtime evidence under supported compositor/window manager.
- [ ] Multi-monitor unplug/replug bounds recovery evidence.
- [ ] Verify capture-protection behavior against PRMPTR's screenshot/Screenpipe path on each OS.
- [ ] Accessibility/contrast review at supported opacity/font scales.

P2 items that require physical compositor/window-manager behavior remain **NOT TESTED** until retained exact-SHA evidence exists. Implementation alone is not a runtime PASS.

## Failure behavior

- Window creation failure leaves the main app usable and does not commit `enabled=true`.
- Click-through/capture configuration failures do not commit rejected native state.
- Publishing content while disabled creates no overlay WebView/process resources.
- Overlay reload/open obtains the retained native snapshot before waiting for future events.
- A hidden overlay remains enabled; explicit Off destroys it.
- Visibility/click-through commands cannot implicitly enable a disabled overlay.
- Shortcut collisions report an error instead of unregistering an unknown owner.
- Overlay data is local application state only and creates no network request by itself.

## Greenfield completion definition

The overlay architecture is implementation-complete when:

1. the static overlay declaration is removed from `tauri.conf.json`;
2. the optional runtime is dynamically owned by `OverlayManager`;
3. completed dashboard response state is projected into a bounded overlay payload;
4. `/overlay` renders that payload and no placeholder copy remains;
5. enable/show/hide/center/click-through controls work through one native contract;
6. overlay shortcuts do not call `unregisterAll` or disturb existing shortcuts;
7. capture protection is enabled by default;
8. tests/guards cover payload bounding/defaults and architectural invariants;
9. token-by-token state is connected only by sharing the existing LLM stream, never by adding a second request;
10. platform runtime claims remain NOT TESTED until physical evidence exists.
