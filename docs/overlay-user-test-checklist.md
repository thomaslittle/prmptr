# PRMPTR Overlay User-Test Checklist

Use this checklist against one exact commit SHA. Record the SHA, OS version, display layout, and result for each test. Source implementation is not a substitute for desktop-window behavior.

## Preflight

Record:

- Commit SHA:
- PRMPTR version:
- OS / version:
- Desktop environment or compositor (Linux):
- Displays, scaling, and primary monitor:
- GPU:

Before opening the app:

```bash
npm ci
npm run overlay:ready:all
```

Expected: the Greenfield guard, overlay unit tests, TypeScript check, Rust overlay tests, and locked Cargo check all pass at the same SHA. If any command fails, stop qualification and retain the output.

## 1. Default-off / resource boundary

1. Clear the `prmptr-overlay.v1` local-storage preference or use a fresh profile.
2. Launch PRMPTR.
3. Confirm the main control says **Overlay off**.
4. Confirm no overlay window is visible.
5. If using a window/process inspector, confirm there is no `overlay` WebView/window before opt-in.

PASS: overlay is opt-in and no optional overlay window exists while disabled.

## 2. Deterministic preview

1. Turn **Overlay on**.
2. Open **Tune**.
3. Confirm runtime status says the window is created and visible.
4. Click **Test overlay**.
5. Observe the sequence:
   - thinking state,
   - streamed preview text,
   - completed `PRMPTR self-test` response,
   - restoration to the real session state.
6. Repeat while hiding the overlay during the preview. It must not pop back open merely because preview state is restored.

PASS: the preview exercises the real native transport without requiring speech or an LLM and returns cleanly to live state.

## 3. Live LLM streaming

1. Start or restore a session with a working LLM provider.
2. Trigger Analyze or submit a chat question.
3. Watch the dashboard and overlay simultaneously.
4. Confirm overlay text updates token-by-token while the dashboard is streaming.
5. Confirm the final completed response appears only once in overlay history.
6. Inspect logs/network activity if available: enabling the overlay must not create a second `/api/llm` request.

PASS: one LLM stream feeds both dashboard and overlay, with no duplicate inference request.

## 4. Auto-show semantics

With **Auto-show on**:

1. Hide the overlay while completed history already exists.
2. Change opacity, text size, or response-history count.
3. Confirm those setting changes do **not** reopen the overlay.
4. Start a genuinely new AI stream. Confirm overlay appears once.
5. Hide it while tokens continue arriving. Confirm token updates do not repeatedly force it open.
6. Finish the response. A newly completed response may auto-show once.

Then turn **Auto-show off**, hide the overlay, and trigger another response.

PASS: only new response activity is eligible to auto-show, and the toggle is respected.

## 5. Drag, resize, and persistence

1. Ensure click-through is OFF / Interactive.
2. Drag the overlay to a distinct location.
3. Resize it to a distinct size.
4. Restart PRMPTR.
5. Confirm size is restored.
6. On Windows/macOS/X11, confirm position is restored.
7. On Wayland, confirm PRMPTR does not claim global-position persistence; use **Center / recover** instead.

PASS: supported persistence is stable and unsupported global positioning is reported truthfully.

## 6. Center / recover

1. Move the overlay away from center.
2. Click **Center / recover** in Tune.
3. Confirm it becomes reachable and centered.
4. Multi-monitor test: move it to a secondary monitor, quit, disconnect that monitor, relaunch, then use Center / recover.

PASS: the user always has a main-window recovery path for stale/off-screen coordinates.

## 7. Click-through and recovery

1. Turn **Clicks pass** on.
2. Click through the overlay into the application underneath it.
3. Confirm the overlay itself cannot accidentally consume pointer input while in pass-through mode.
4. Recover interactivity from the main PRMPTR control.
5. Repeat with the click-through global shortcut.
6. Toggle show/hide with the show/hide shortcut while another app has focus.

PASS: click-through works and never traps the user in an unrecoverable state.

## 8. Shortcut isolation

Default overlay bindings:

- Show/hide: `CommandOrControl+Shift+H`
- Click-through: `CommandOrControl+Shift+C`

Test:

1. Verify existing PRMPTR Analyze/Clear/Settings shortcuts still work after enabling overlay.
2. Disable and re-enable overlay; main shortcuts must remain registered.
3. If an OS/application conflict exists, confirm PRMPTR reports an overlay shortcut registration error instead of silently stealing/unregistering another binding.

PASS: overlay registration is independently owned and does not disturb unrelated shortcuts.

## 9. Capture shield

### Windows / macOS

1. Confirm Tune reports capture shield as supported.
2. Enable **Capture shield**.
3. Run the overlay preview so visible content exists.
4. Capture the desktop using PRMPTR's screenshot path and, when applicable, Screenpipe/OCR.
5. Confirm overlay content is excluded according to platform behavior.
6. Disable Capture shield and repeat to verify the control actually changes behavior.

Do not mark PASS solely because the UI says `shield effective`; retain an actual captured frame/OCR result.

### Linux

1. Confirm Tune displays **Shield unsupported** and a warning.
2. Confirm the UI does not claim the shield is effective.
3. Confirm the user's desired shield preference is not destructively rewritten just because Linux cannot enforce it.

PASS: capability reporting matches actual platform support.

## 10. Close / destroy lifecycle

1. Enable overlay.
2. Close/destroy the overlay through an OS-level close path where available (for example Alt+F4 while focused).
3. Return to the main window.
4. Confirm the main state reconciles to Overlay off rather than claiming a dead window is enabled.
5. Turn it on again and confirm a fresh window can be created.
6. Turn it off from the main PRMPTR control and confirm the optional window is destroyed rather than merely hidden.

PASS: native lifecycle truth and persisted opt-in state stay synchronized.

## 11. Appearance and content stress

Test at minimum:

- opacity 45% and 100%,
- text size 80% and 150%,
- 1 and 8 retained responses,
- long Markdown response,
- lists/code/links,
- very long unbroken token/string,
- rapid token streaming,
- empty response history,
- chat and analysis response types.

PASS: no clipping that blocks use, no runaway window growth, no crashes, and scrolling remains usable.

## 12. Always-on-top behavior

Check overlay above:

- PRMPTR main window,
- browser,
- terminal/editor,
- a normal maximized desktop app,
- any target full-screen/game mode relevant to PRMPTR users.

Record exceptions by OS/window mode rather than generalizing one result to all platforms.

## User-test entry gate

The overlay is ready for broader user testing when, on the target OS:

- `npm run overlay:ready:all` passes at the retained SHA;
- deterministic Test overlay passes;
- real token streaming passes without a duplicate LLM request;
- show/hide, click-through, Center/recover, resize, and restart persistence pass;
- auto-show semantics pass;
- shortcut isolation passes;
- capability UI is truthful;
- capture-shield behavior is retained as evidence on Windows/macOS or explicitly reported unsupported on Linux;
- no P0/P1 crash, trapping, invisible-window, or duplicated-inference defect remains.

A platform may enter limited user testing with a documented NOT TESTED/unsupported P2 compositor behavior, but not with a known correctness or recoverability defect.
