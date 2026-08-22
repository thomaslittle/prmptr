# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately via [GitHub Security Advisories](https://github.com/thomaslittle/prmptr/security/advisories/new)
("Report a vulnerability" button), or email the owner directly from their
GitHub profile.

Include as much of the following as you can:

- The type of issue (e.g. SSRF, key exposure, privilege escalation)
- Step-by-step reproduction or proof-of-concept
- Affected files/commits
- Potential impact

You'll get an acknowledgment within 72 hours. We'll keep you informed about
fix progress and credit you in the release notes (unless you prefer to stay
anonymous).

## Scope notes

PRMPTR is a desktop app that runs a local Next.js server and spawns/manages
native processes (screenpipe, Whisper, TTS). Areas of particular interest:

- `lib/api-guard.ts` — loopback-only guards for all API routes
- `src-tauri/src/screenpipe/` — process management, downloads, key redaction
- `src-tauri/src/commands.rs` — IPC surface (URL opening, TTS proxying,
  model downloads)
- `tauri.conf.json` — CSP and capability configuration
- `lib/secret-store.ts` — credential storage

## Known design constraints

- The Next.js dev/beta server binds to loopback only and rejects cross-site
  origins, but any **local** process can reach it while it runs. This is
  inherent to serving a Tauri webview from a dev server; production builds
  bundle the frontend instead.
- Screen/audio transcription is inherently sensitive. Cloud modes
  (Deepgram, vision uploads) send data off-device only when explicitly
  enabled; the default configuration is fully local.
