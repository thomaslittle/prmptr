# Contributing to PRMPTR

Thanks for wanting to contribute! This doc gets you from clone to merged PR.

## Dev setup

```bash
git clone https://github.com/thomaslittle/prmptr.git
cd prmptr
npm install
npm run tauri dev   # launches the desktop app in dev mode
```

Requirements: Node 20+, Rust toolchain, Tauri v2 prerequisites
([guide](https://tauri.app/start/prerequisites/)). For GPU-accelerated local
transcription during development, see the CUDA notes in
`src-tauri/.cargo/config.toml`.

## Before you open a PR

Run all four gates — CI-equivalent checks:

```bash
npm run typecheck   # must be clean (0 errors)
npm run lint        # must be 0 errors (warnings negotiable)
npm test            # vitest — all green
cargo check         # run inside src-tauri/ — must be clean
```

## Ground rules

1. **Read [docs/architecture.md](docs/architecture.md) first.** All LLM traffic
   goes through the single TS path (`lib/llm-providers.ts` via `/api/llm`) —
   the legacy Rust LLM stack was removed in 2026-08. The overlay window is a
   documented future feature; see the architecture doc before touching it.
2. **Security-sensitive code** (`lib/api-guard.ts`, `src-tauri/src/screenpipe/`,
   `commands.rs` IPC surface, CSP) — explain your reasoning in the PR. All API
   routes must stay loopback-only and origin-checked; never fetch arbitrary
   user-supplied URLs server-side without going through `parseLocalHttpUrl`.
3. **Secrets**: keys live in `lib/secret-store.ts` → Tauri secure store. Never
   persist credentials to localStorage/IndexedDB/logs. The Deepgram key must
   stay redacted from logs and child-process argv.
4. **Tests welcome**: pure functions in `lib/` are cheap to test — see
   `lib/__tests__/` for examples. Bug fixes should come with a regression test
   when practical.
5. **Match existing style** — 4-space indent, existing naming conventions,
   no comments unless they explain *why*.

## Commit style

Short imperative subject (`Fix SSE chunk-boundary splitting`), blank line,
optional body explaining *why*. One logical change per commit.

## Reporting bugs

Open a GitHub issue with: what you did, what you expected, what happened
(include relevant console/log output). For security issues, see
[SECURITY.md](SECURITY.md) — please don't open public issues for those.

## Licensing

By contributing you agree your contributions are licensed under the MIT
License found in [LICENSE](LICENSE).
