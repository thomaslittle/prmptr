# Changelog

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
