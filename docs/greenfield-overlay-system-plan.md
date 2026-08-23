# Greenfield Overlay System Goal

## Goal

Build PRMPTR's always-on-top response overlay as a first-class, optional desktop subsystem that can be enabled without changing the speech/LLM pipeline and disabled with zero overlay-window runtime cost.

The overlay is a **consumer of canonical PRMPTR state**, never a second inference loop. It displays the same live/finished AI responses that the dashboard already owns.

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

## Architecture

```text
SessionStore / response stream
          |
          v
OverlayFeatureController (main WebView)
  - persists user preferences
  - publishes bounded response snapshots
  - owns overlay shortcuts
  - syncs native runtime state
          |
          v
Tauri OverlayManager
  - enabled/runtime truth
  - dynamic WebviewWindow create/destroy
  - always-on-top / click-through / capture protection
  - hide/show lifecycle
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

The main window bounds history before publishing. The native manager stores the newest complete payload so creating/reloading the overlay cannot miss the current response.

## P0 — correctness and ownership

- [x] Dynamic overlay window instead of startup-created hidden WebView.
- [x] Default OFF optional feature contract.
- [x] Native overlay lifecycle manager.
- [x] Always-on-top undecorated transparent desktop window.
- [x] Capture protection default ON.
- [x] Click-through default OFF.
- [x] Native response snapshot + event transport.
- [x] Overlay route renders real streaming/completed PRMPTR responses.
- [x] No duplicate speech/LLM/session ownership.
- [x] Main-window control can recover from click-through mode.
- [x] Bounds are reported by native window events.

## P1 — usability

- [x] Persist overlay enablement/config independently from general secrets/settings.
- [x] Auto-show on new/streaming response option.
- [x] Show/hide without disabling.
- [x] Global show/hide shortcut.
- [x] Global click-through shortcut.
- [x] Shortcut registration coexists with PRMPTR's existing global shortcuts.
- [x] Persist opacity/font scale/history count.
- [x] Compact main-window overlay control.
- [x] Bounded response history in overlay.
- [x] Streaming-state presentation.

## P2 — qualification / polish

- [ ] Exact-SHA Windows runtime evidence: create, show, drag, resize, hide, click-through, destroy.
- [ ] Exact-SHA macOS runtime evidence for always-on-top/capture protection behavior.
- [ ] Exact-SHA Linux runtime evidence under supported compositor/window manager.
- [ ] Multi-monitor unplug/replug bounds recovery evidence.
- [ ] Verify capture-protection behavior against PRMPTR's screenshot/Screenpipe path on each OS.
- [ ] Accessibility/contrast review at supported opacity/font scales.

P2 items that require physical compositor/window-manager behavior remain **NOT TESTED** until retained exact-SHA evidence exists. Implementation alone is not a runtime PASS.

## Failure behavior

- Window creation failure leaves the main app usable and reports an overlay error.
- Click-through failure does not change the persisted preference.
- Publishing content while disabled stores no extra WebView/process resources.
- Overlay reload/open obtains the native snapshot before waiting for future events.
- A hidden overlay remains enabled; disabling destroys it.
- Overlay data is local application state only and creates no network request by itself.

## Greenfield completion definition

The overlay architecture is implementation-complete when:

1. the static overlay declaration is removed from `tauri.conf.json`;
2. the optional runtime is dynamically owned by `OverlayManager`;
3. dashboard response state is projected into a bounded overlay payload;
4. `/overlay` renders that payload and no placeholder copy remains;
5. enable/show/hide/click-through controls work through one native contract;
6. overlay shortcuts do not call `unregisterAll` or disturb existing shortcuts;
7. capture protection is enabled by default;
8. tests cover payload bounding/defaults and native configuration invariants;
9. platform runtime claims remain NOT TESTED until physical evidence exists.
