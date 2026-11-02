# Changelog

## 0.2.2 — 2026-11-02

### Linux launch diagnostics

- **Fedora 44 + KDE Wayland + NVIDIA no longer disappears silently.**
  WebKitGTK 2.54.0/2.54.1 has a DMA-BUF rendering regression (WebKit bug
  324551, fixed in 2.54.2) that aborts with
  `Gdk-Message: Error 71 (Protocol error)`. PRMPTR now checks the linked
  WebKitGTK version, session type and NVIDIA driver *before* creating the
  WebView, shows a native `kdialog`/`zenity` message with the exact
  `dnf upgrade` command, and offers to start in compatibility mode
  (`WEBKIT_DISABLE_DMABUF_RENDERER=1`).
- `PRMPTR_WEBKIT_COMPAT=1` forces compatibility mode and `=0` skips the check.
  Normal accelerated rendering is used once WebKitGTK is updated.
- Unit tests cover the version/session/GPU decision. The Fedora RPM still
  declares the normal WebKitGTK library dependency rather than pinning a
  Fedora 44-only version, so installs on older Fedora releases remain valid.

## 0.2.1 — 2026-11-02

### Linux packages

- **Fixed the RPM/DEB failing to start** (`libsherpa-onnx-c-api.so: cannot open
  shared object file`). The Linux packages never included sherpa-onnx's shared
  libraries, and the binary had no path to them. `scripts/stage-native-libs.mjs`
  now stages `libsherpa-onnx-c-api.so`, `libsherpa-onnx-cxx-api.so` and
  `libonnxruntime.so`; `tauri.linux.conf.json` packages them under
  `/usr/lib/PRMPTR`; and the Linux RUNPATH (`$ORIGIN/../lib/PRMPTR`) lets the
  executable find them without `LD_LIBRARY_PATH` or `ldconfig`.
- The Windows runtime staging moved to the same cross-platform script and
  `tauri.windows.conf.json`; the release build no longer needs a separate
  bundle config.
- CI now extracts the built `.deb` and fails if `ldd` reports a missing
  library, and checks that the `.rpm` ships the sherpa libraries.

## 0.2.0 — 2026-11-02

The first release with the complete desktop app: on-device transcription, the
streaming overlay, "Your AI apps" through OriginLM, and a personal glossary.

### Your AI apps

- **OpenCode now lists its models.** OriginLM probes only native executables,
  and OpenCode's npm install is a `.cmd` shim, so every OpenCode probe failed
  with `RuntimeMissing`. Discovery now resolves the native binary behind the
  shim (`node_modules/@opencode/cli/bin`) and Windows launches inherit a
  `HOME`, which the adapter needs to find OpenCode's service descriptor.
- **Subscription routes are offered.** Gateway apps publish one route per
  upstream; PRMPTR filtered on the route's provider id, which dropped
  `opencode-go` (the included subscription route) and left only metered Console
  models. Filtering is now by the installed app, and when the same model is
  published on several routes the included (subscription or local) route wins,
  so selecting a model cannot silently bill a metered route.

### Speech

- **Glossary** (Settings → Capture): `Term` or `Term = mishearing`. Parakeet
  biases decoding toward the terms, listed mishearings are rewritten after
  transcription, and the AI's suggestions get the correct spellings.
- **Better resampling:** any channel count (including 6–8 channel loopback
  devices) is downmixed and resampled with a band-limited FFT resampler, so
  energy above the speech band is filtered instead of aliased.
- **Speaker names:** click a "Speaker N" chip to rename it; the AI sees
  `[YOU]` / `[THEM: Sarah]` in prompts.

### Overlay and app

- Always-on-top overlay, hidden from screen capture by default, with
  click-through and show/hide shortcuts.
- Provider errors are readable and actionable ("Sign in to Claude Code again")
  instead of raw API text.
- Proper multi-size app icons in the installers.
- Live per-channel mute, audio activity meters, and session history.

### Testing

- Playwright end-to-end suite against a fake Rust backend.
- Real-app smoke test over WebView2 DevTools: speech through the system-audio
  loopback, glossary, overlay, and an OpenCode model check.
- Rust unit tests for VAD segmentation, the model catalog, OriginLM mapping,
  and the OpenCode discovery fix.

## 0.1.0

Initial private build.
