# PRMPTR — Real-Time AI Audio Assistant

## Product Requirements Document & Claude Code Build Prompt

---

## 1. Product Overview

### What It Is
PRMPTR is a lightweight Windows desktop application that leverages **screenpipe** for real-time audio capture and transcription, then feeds the rolling transcript to an LLM of the user's choice (Anthropic, OpenAI, Groq, or a local LM Studio model) to generate contextual responses displayed in a minimal, always-on-top overlay.

### What Makes It Different
PRMPTR is **session-based, not mode-locked.** When you start a listening session, you tell PRMPTR what it's listening to — an interview, a GTA RP session, a podcast, a lecture, a therapy appointment, a D&D game, a sales call — anything. PRMPTR uses that context to tailor its responses. Pre-built session templates exist for common scenarios, but you can describe any situation in plain English.

### Example Sessions
- **"I'm in a senior React/TypeScript technical interview. Help me answer coding questions clearly and concisely."**
- **"I'm playing GTA RP as Marcus 'Slink' DeLeon, a used car dealer with mob ties. Suggest in-character dialogue."**
- **"I'm listening to a podcast about AI safety. Summarize key points and flag anything I should research later."**
- **"I'm on a sales call with a prospect for our SaaS product. Help me handle objections and suggest talking points."**
- **"I'm in a college lecture on organic chemistry. Help me understand concepts as they're explained."**
- **"I'm pair programming with a teammate. Listen and suggest solutions when we get stuck."**

### Why Tauri + Screenpipe

| Factor | Approach | Benefit |
|--------|----------|---------|
| Memory footprint | Tauri v2 (~30-50MB) | Runs alongside resource-heavy games/meetings |
| Bundle size | ~5-10MB (vs ~150MB+ Electron) | Fast install, low disk usage |
| Audio capture | Screenpipe (external process) | Battle-tested WASAPI capture, device management, VAD |
| Transcription | Screenpipe (Whisper + Deepgram realtime) | Dual-engine: free local whisper + low-latency Deepgram |
| Overlay | Tauri native window | Minimal overhead, game-friendly |
| Architecture | Screenpipe = audio/transcription, Tauri = UI/LLM | Clean separation of concerns |

**Decision: Tauri v2 + Screenpipe** — Screenpipe handles the entire audio capture and transcription pipeline (device enumeration, WASAPI capture, VAD, whisper/deepgram transcription). PRMPTR manages the screenpipe process, consumes its real-time transcription stream, and handles the LLM + UI layer.

### Current State (Web Prototype)

A fully functional web prototype is already built and running. It serves as the foundation for the Tauri desktop app.

**What's working now:**
- Next.js 16 + React 19 + Tailwind v4 + shadcn/ui (base-lyra style, stone base, dark mode)
- Live audio transcription feed via screenpipe WebSocket → SSE bridge
- Multi-provider LLM streaming (Anthropic, OpenAI, Groq, LM Studio local)
- Session configuration with templates, context editing, model selection
- Settings panel with API key management, connection testing
- Health monitoring for screenpipe connection
- TanStack React Query for data fetching, React state + localStorage for persistence

**What's NOT built yet (requires Tauri):**
- Native desktop window (overlay, always-on-top, click-through)
- Screenpipe process management (start/stop/restart from the app)
- Global hotkeys (Ctrl+Shift+Space, etc.)
- OS keychain storage for API keys
- System tray integration
- Zustand state management (currently React state + localStorage)
- TOML template files (currently hardcoded in React component)

The web prototype runs at `http://localhost:3000` with screenpipe running separately at `http://localhost:3030`. The transition to Tauri wraps this existing frontend and migrates server-side logic to Rust.

---

## 2. LLM Provider & Model Support

### Supported Providers

Users enter API keys for one or more cloud providers, and/or use a local LM Studio server. Only models suitable for real-time conversational assistance are listed.

#### LM Studio (Local)
| Model | ID | Speed | Best For |
|-------|----|-------|----------|
| User's loaded model | (dynamic) | Varies | Free, private, offline operation |

LM Studio runs a local OpenAI-compatible API at `http://localhost:1234`. Users load any model they want — PRMPTR auto-detects available models via the `/v1/models` endpoint.

#### Anthropic
| Model | ID | Speed | Best For |
|-------|----|-------|----------|
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` | Fast | Default — best speed/quality balance |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Fastest | Cost-conscious, rapid-fire sessions |
| Claude Opus 4.5 | `claude-opus-4-5-20250918` | Slower | Complex technical interviews, deep analysis |

#### OpenAI
| Model | ID | Speed | Best For |
|-------|----|-------|----------|
| GPT-4o | `gpt-4o` | Fast | General purpose, good all-rounder |
| GPT-4o Mini | `gpt-4o-mini` | Fastest | Cost-conscious, simple Q&A |
| GPT-4.1 | `gpt-4.1` | Fast | Latest model, strong reasoning |
| GPT-4.1 Mini | `gpt-4.1-mini` | Fastest | Latest small model, great value |
| GPT-4.1 Nano | `gpt-4.1-nano` | Fastest | Ultra-fast, lowest cost |

#### Groq
| Model | ID | Speed | Best For |
|-------|----|-------|----------|
| Llama 3.3 70B | `llama-3.3-70b-versatile` | Blazing | Fast + capable, great default |
| Llama 3.1 8B Instant | `llama-3.1-8b-instant` | Blazing | Ultra-fast simple responses |
| Llama 4 Scout | `llama-4-scout-17b-16e-instruct` | Fast | Newest Llama, strong reasoning |
| Mixtral 8x7B | `mixtral-8x7b-32768` | Blazing | Large context window |
| Gemma 2 9B | `gemma2-9b-it` | Blazing | Good quality/speed tradeoff |

### Provider Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LLM Orchestrator                      │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │Anthropic │ │ OpenAI   │ │  Groq    │ │ LM Studio  │ │
│  │ Client   │ │ Client   │ │  Client  │ │  Client    │ │
│  │          │ │          │ │          │ │ (local)    │ │
│  │ SSE      │ │ SSE      │ │ SSE      │ │ SSE        │ │
│  │ stream   │ │ stream   │ │ stream   │ │ stream     │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
│       └──────────┬──┴────────────┴─────────────┘        │
│                  ▼                                       │
│       Unified Response Stream                            │
│       (provider-agnostic token events)                   │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
             Frontend Overlay
```

All providers use a streaming API pattern, but with different:
- **Endpoints:** Anthropic `/v1/messages`, OpenAI `/v1/chat/completions`, Groq `/v1/chat/completions` (OpenAI-compatible), LM Studio `http://localhost:1234/v1/chat/completions` (OpenAI-compatible)
- **Auth headers:** Anthropic uses `x-api-key`, OpenAI/Groq use `Authorization: Bearer`, LM Studio uses no auth (or dummy Bearer)
- **SSE formats:** Anthropic uses `content_block_delta`, OpenAI/Groq/LM Studio use `choices[0].delta.content`

The Rust backend implements a `LlmProvider` trait that normalizes these differences into a unified stream of text tokens.

### Model Selection UX
- Settings panel shows only providers where the user has entered an API key (or LM Studio if connected)
- LM Studio models are fetched dynamically from the `/v1/models` endpoint
- Models are grouped by provider with speed/capability indicators
- User picks a default model but can override per-session
- If a provider's API returns an error (invalid key, rate limit), show inline error and suggest switching

---

## 3. Session System

### How Sessions Work

Instead of rigid "modes," PRMPTR uses a **session-based** approach. When the user starts listening, they describe what they're listening to. This becomes the core context for the LLM.

#### Starting a Session

The user sees a session start screen:

```
┌──────────────────────────────────────────────┐
│                                              │
│  What are you listening to?                  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ I'm in a senior React/TypeScript       │  │
│  │ technical interview at a fintech       │  │
│  │ company. Help me answer questions      │  │
│  │ clearly and concisely with code        │  │
│  │ examples when relevant.               │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ── or start from a template ──              │
│                                              │
│  [Technical Interview]                       │
│  [GTA Roleplay]                              │
│  [Work Meeting]                              │
│  [Podcast Listener]                          │
│  [Lecture/Class]                             │
│  [General Conversation]                      │
│                                              │
│  ── Session Settings ──                      │
│                                              │
│  Model: [Claude Sonnet 4.5 v]               │
│  Trigger: [* Auto  o Manual  o Continuous]   │
│  Response style: [* Concise  o Detailed]     │
│                                              │
│  [> Start Session]                           │
│                                              │
└──────────────────────────────────────────────┘
```

#### Session Templates

Templates pre-fill the context field and adjust defaults. They're stored as TOML files and users can create their own.

```toml
# templates/technical-interview.toml
[template]
id = "technical-interview"
name = "Technical Interview"
icon = "briefcase"
description = "Real-time help answering technical coding questions"

[defaults]
trigger_mode = "auto"
response_style = "concise"
temperature = 0.3
max_tokens = 500
context_window_secs = 60

[prompt]
context_prefill = """I'm in a technical coding interview. Help me answer questions clearly and concisely. When the interviewer asks a technical question:
1. Give a correct, concise answer (2-3 sentences)
2. Include a brief code example if applicable
3. Add one insight that shows deep understanding
Format for quick scanning — I need to glance and immediately use your response."""

response_format = """Respond in this format:
**Q:** [the question]
**A:** [concise answer]
```[language]
[code if relevant]
```
> [one key insight]"""
```

```toml
# templates/gta-rp.toml
[template]
id = "gta-rp"
name = "GTA Roleplay"
icon = "masks-theater"
description = "In-character dialogue suggestions for GTA RP"

[defaults]
trigger_mode = "continuous"
continuous_interval_secs = 8
response_style = "concise"
temperature = 0.8
max_tokens = 300
context_window_secs = 30

[prompt]
context_prefill = """I'm playing GTA RP. Listen to the in-game conversation and suggest in-character dialogue options. Give me exactly 3 options:
A serious/dramatic option
A humorous option
A clever/strategic option
Keep each under 20 words. Match the scene energy. Never break character."""

response_format = """SERIOUS: [serious dialogue]
FUNNY: [funny dialogue]
CLEVER: [clever dialogue]"""

# User should add their character details to the context field:
context_hint = "Add your character details: name, occupation, backstory, speech style, current situation"
```

```toml
# templates/meeting.toml
[template]
id = "meeting"
name = "Work Meeting"
icon = "clipboard"
description = "Meeting assistant — answers, talking points, and summaries"

[defaults]
trigger_mode = "auto"
response_style = "concise"
temperature = 0.3
max_tokens = 400
context_window_secs = 90

[prompt]
context_prefill = """I'm in a work meeting. Help me participate effectively:
- When someone asks me a question, give me a quick answer
- Suggest relevant talking points I could bring up
- Flag key decisions and action items as they happen
Be professional, concise, factual. I may glance at your response while speaking."""

response_format = ""
```

```toml
# templates/podcast.toml
[template]
id = "podcast"
name = "Podcast Listener"
icon = "microphone"
description = "Summarize key points and flag interesting ideas from podcasts"

[defaults]
trigger_mode = "continuous"
continuous_interval_secs = 30
response_style = "concise"
temperature = 0.3
max_tokens = 300
context_window_secs = 120

[prompt]
context_prefill = """I'm listening to a podcast. Every 30 seconds or so, give me:
- A 1-sentence summary of what was just discussed
- Any key claims, statistics, or names worth noting
- Anything I should research or look into later
Keep it brief — I want running notes, not essays."""

response_format = """SUMMARY: [summary]
KEY POINTS: [key points]
RESEARCH: [research later]"""
```

```toml
# templates/lecture.toml
[template]
id = "lecture"
name = "Lecture / Class"
icon = "book-open"
description = "Understand and take notes on academic lectures in real-time"

[defaults]
trigger_mode = "continuous"
continuous_interval_secs = 20
response_style = "detailed"
temperature = 0.3
max_tokens = 500
context_window_secs = 120

[prompt]
context_prefill = """I'm in a lecture/class. Help me understand what's being taught:
- Explain concepts in simpler terms as the lecturer mentions them
- Connect new concepts to foundational knowledge
- Flag key terms or definitions I should write down
- If something is confusing, explain it differently"""

response_format = ""
```

```toml
# templates/general.toml
[template]
id = "general"
name = "General Conversation"
icon = "chat-circle"
description = "General-purpose assistant for any conversation"

[defaults]
trigger_mode = "manual"
response_style = "concise"
temperature = 0.5
max_tokens = 400
context_window_secs = 60

[prompt]
context_prefill = """I'm in a conversation. When I trigger you, help me with whatever seems most relevant based on what's being discussed. Be helpful, concise, and context-aware."""

response_format = ""
```

#### How Context Becomes the System Prompt

When a session starts, PRMPTR assembles the system prompt:

```
[BASE_INSTRUCTIONS]
You are PRMPTR, a real-time audio assistant. You receive rolling transcripts
of a live conversation captured from the user's audio devices via screenpipe.
The user labeled "me" is your user. Everyone else is labeled "them" or with
speaker diarization labels.

Your job is to help the user based on the session context below. Be concise
— the user is reading your responses in a small overlay while doing
something else. Format for quick scanning.

[SESSION_CONTEXT]
{user's context description from the session start screen}

[RESPONSE_FORMAT (if template provided one)]
{template response format, or empty}

[TRIGGER_INFO]
Trigger mode: {auto|manual|continuous}
{If auto: "You're receiving this because a question or prompt was detected."}
{If continuous: "You're receiving this every N seconds. Summarize/respond to the latest content."}
{If manual: "The user manually asked you to respond to what they're hearing."}
```

This means ANY session context works — the user can type literally anything and the LLM adapts.

#### Current Implementation Notes

The web prototype differs from the target spec in these areas:

**Templates:** Currently 6 hardcoded templates in `session-config.tsx` (Coding, Meeting, Research, Interview, Learning, General) rather than TOML files. The hardcoded templates are more general-purpose; the TOML templates above are more audio-focused. Both sets will be available in the Tauri version — hardcoded as defaults, with TOML files for user-created templates.

**Trigger modes:** The web prototype implements two modes:
- **Manual** — user clicks "Analyze Now" button
- **Auto** — timer fires every N seconds (maps to the PRD's "continuous" mode)

The PRD's three-mode system (auto/manual/continuous) adds **question detection** for "auto" mode — detecting question keywords (who/what/when/where/why/how) in the transcript to auto-trigger. This requires the Rust transcript manager for keyword analysis. Until then, the web prototype's "auto" mode acts as a simple timer.

**Prompt builder:** The current `lib/prompt-builder.ts` uses a simplified prompt structure compared to the full `[BASE_INSTRUCTIONS] + [SESSION_CONTEXT] + [RESPONSE_FORMAT] + [TRIGGER_INFO]` spec above. The current implementation omits `[RESPONSE_FORMAT]` and has a simplified `[TRIGGER_INFO]`.

---

## 4. Architecture

### Development Architecture (Current — Web Prototype)

The web prototype uses Next.js API routes as a bridge layer between the browser and external services (screenpipe, LLM providers). This architecture runs entirely in the browser + Node.js server, no Tauri required.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser (localhost:3000)                          │
│                                                                      │
│  ┌──────────────────────── React Frontend ───────────────────────┐  │
│  │  Next.js 16 + shadcn/ui + Tailwind v4                         │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │  │
│  │  │  Dashboard    │  │  Live Feed   │  │  Session Config    │   │  │
│  │  │  (layout)     │  │  (SSE hook)  │  │  + Settings       │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────┘   │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │  │
│  │  │  AI Response  │  │  Query       │  │  Settings          │   │  │
│  │  │  (streaming)  │  │  Provider    │  │  Panel             │   │  │
│  │  └──────┬───────┘  └──────────────┘  └────────────────────┘   │  │
│  └─────────┼──────────────────────────────────────────────────────┘  │
│            │                                                         │
│            ▼                                                         │
│  ┌──────────────────────── API Routes ────────────────────────────┐  │
│  │                                                                │  │
│  │  /api/stream    WebSocket→SSE bridge to screenpipe             │  │
│  │  /api/health    Proxy to screenpipe /health                    │  │
│  │  /api/llm       LLM streaming proxy (all 4 providers)         │  │
│  │  /api/lmstudio-test  LM Studio connection test                │  │
│  │                                                                │  │
│  └───────────┬────────────────────────────┬───────────────────────┘  │
│              │                            │                          │
└──────────────┼────────────────────────────┼──────────────────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────┐    ┌──────────────────────────────────────┐
│  Screenpipe          │    │  LLM Providers                       │
│  localhost:3030      │    │                                      │
│                      │    │  LM Studio  (localhost:1234)         │
│  WS: /ws/events      │    │  Anthropic  (api.anthropic.com)     │
│  HTTP: /health       │    │  OpenAI     (api.openai.com)        │
│  HTTP: /search       │    │  Groq       (api.groq.com)          │
│  HTTP: /audio/list   │    │                                      │
└──────────────────────┘    └──────────────────────────────────────┘
```

**Key implementation files (web prototype):**

| File | Purpose |
|------|---------|
| `app/api/stream/route.ts` | WebSocket→SSE bridge — connects to screenpipe WS, emits SSE events to browser |
| `app/api/health/route.ts` | Proxies health checks to screenpipe via `ScreenpipeClient` |
| `app/api/llm/route.ts` | POST endpoint — streams LLM responses from any provider as SSE |
| `app/api/lmstudio-test/route.ts` | GET endpoint — tests LM Studio `/v1/models` connectivity |
| `hooks/use-screenpipe.ts` | `useScreenpipeFeed()` (EventSource SSE) + `useScreenpipeHealth()` (TanStack Query) |
| `lib/llm-providers.ts` | `streamLLMResponse()` async generator — Anthropic + OpenAI-compatible streaming |
| `lib/prompt-builder.ts` | `buildSystemPrompt()` + `buildUserMessage()` + `truncateFeedItems()` |
| `lib/screenpipe-client.ts` | `ScreenpipeClient` class — HTTP queries, health checks, feed item conversion |
| `lib/types.ts` | All types + model registry + `getAvailableModels()` |

### Production Architecture (Target — Tauri v2)

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRMPTR (Tauri v2)                            │
│                                                                      │
│  ┌────────────────────────── Rust Backend ─────────────────────────┐ │
│  │                                                                  │ │
│  │  ┌──────────────────────────────────────────────────────────┐   │ │
│  │  │                 Screenpipe Manager                        │   │ │
│  │  │  - Start/stop/restart screenpipe process                 │   │ │
│  │  │  - Configure: audio devices, realtime, VAD, engine       │   │ │
│  │  │  - Monitor health via HTTP API                           │   │ │
│  │  │  - Binary: screenpipe.exe (bundled or user-installed)    │   │ │
│  │  └────────────────────────┬─────────────────────────────────┘   │ │
│  │                           │                                      │ │
│  │                           ▼                                      │ │
│  │  ┌──────────────────────────────────────────────────────────┐   │ │
│  │  │                 Screenpipe Bridge                         │   │ │
│  │  │  WebSocket: ws://localhost:3030/ws/events                │   │ │
│  │  │  → Real-time transcription events                        │   │ │
│  │  │  HTTP: http://localhost:3030                              │   │ │
│  │  │  → /health, /search, /audio/list                         │   │ │
│  │  └────────────────────────┬─────────────────────────────────┘   │ │
│  │                           │                                      │ │
│  │                           ▼                                      │ │
│  │  ┌──────────────────────────────────────────────────────────┐   │ │
│  │  │                 Transcript Manager                        │   │ │
│  │  │  - Rolling window (configurable, default 120s)           │   │ │
│  │  │  - Speaker labels from screenpipe events                 │   │ │
│  │  │  - Trigger detection (auto/manual/continuous)            │   │ │
│  │  │  - Deduplication via event IDs                           │   │ │
│  │  └────────────────────────┬─────────────────────────────────┘   │ │
│  │                           │                                      │ │
│  │                           ▼                                      │ │
│  │  ┌──────────────────────────────────────────────────────────┐   │ │
│  │  │                 LLM Orchestrator                          │   │ │
│  │  │  ┌────────────────────────────────────────────────────┐  │   │ │
│  │  │  │  Provider Trait                                     │  │   │ │
│  │  │  │  ├─ AnthropicClient                                │  │   │ │
│  │  │  │  ├─ OpenAIClient                                   │  │   │ │
│  │  │  │  ├─ GroqClient                                     │  │   │ │
│  │  │  │  └─ LmStudioClient (local, OpenAI-compatible)      │  │   │ │
│  │  │  └────────────────────────────────────────────────────┘  │   │ │
│  │  │  - Prompt assembly (session context + transcript)        │   │ │
│  │  │  - Streaming response via Tauri events                   │   │ │
│  │  │  - Debounce & queue                                      │   │ │
│  │  └────────────────────────┬─────────────────────────────────┘   │ │
│  │                           │                                      │ │
│  └───────────────────────────┼──────────────────────────────────────┘ │
│                              │ Tauri Events (IPC)                     │
│                              ▼                                        │
│  ┌────────────────────────── React Frontend ───────────────────────┐  │
│  │  Next.js + shadcn/ui + Tailwind v4                              │  │
│  │                                                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │  │
│  │  │  Session      │  │  Overlay     │  │  Settings              │ │  │
│  │  │  Start Screen │  │  Window      │  │  (LLM + Screenpipe)   │ │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────────┘ │  │
│  │                                                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │  │
│  │  │  Live         │  │  Response    │  │  Screenpipe            │ │  │
│  │  │  Transcript   │  │  History     │  │  Controls              │ │  │
│  │  └──────────────┘  └──────────────┘  └────────────────────────┘ │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### Rust Backend (src-tauri/)

| Module | Responsibility | Key Crates |
|--------|---------------|------------|
| `screenpipe::manager` | Start/stop/restart screenpipe process, health monitoring | `tokio::process`, `reqwest` |
| `screenpipe::bridge` | WebSocket connection to screenpipe events, HTTP API queries | `tokio-tungstenite`, `reqwest` |
| `screenpipe::config` | Screenpipe launch arguments (devices, engine, realtime, VAD) | `serde` |
| `transcription::transcript` | Data structures, rolling buffer, deduplication | — |
| `llm::provider` | `LlmProvider` trait definition | — |
| `llm::anthropic` | Claude API streaming client | `reqwest`, `tokio` |
| `llm::openai` | OpenAI API streaming client | `reqwest`, `tokio` |
| `llm::groq` | Groq API streaming client | `reqwest`, `tokio` |
| `llm::lmstudio` | LM Studio local API streaming client (OpenAI-compatible) | `reqwest`, `tokio` |
| `llm::prompt_builder` | Assembles prompts from session context + transcript | — |
| `session::manager` | Session lifecycle, template loading | `serde`, `toml` |
| `session::trigger` | Auto/manual/continuous trigger logic | — |
| `hotkeys` | Global hotkey registration | `tauri-plugin-global-shortcut` |
| `overlay` | Window management, always-on-top | Tauri window API |
| `config` | Settings persistence | `tauri-plugin-store` |
| `state` | Shared app state | `tokio::sync` |

#### React Frontend

**Currently implemented (web prototype):**

| Component | Purpose |
|-----------|---------|
| `Dashboard` | Main layout — header, three-column view, state management, localStorage persistence |
| `LiveFeed` | Real-time scrolling transcript feed with audio/screen badges and timestamps |
| `AiResponse` | Streamed LLM responses with auto/manual trigger, response history |
| `SessionConfig` | Session context textarea, templates, model selector, trigger/style controls |
| `SettingsPanel` | Screenpipe URL, LM Studio URL, cloud API keys with test buttons |
| `QueryProvider` | TanStack React Query client wrapper |

**Target (Tauri — to be built):**

| Component | Purpose |
|-----------|---------|
| `SessionStartScreen` | Full-page session creation UI (context textarea, template cards, model picker) |
| `OverlayWindow` | Transparent, always-on-top response display (separate Tauri window) |
| `ScreenpipeControls` | Start/stop screenpipe, audio device selector, realtime toggle, engine picker |
| `TranscriptView` | Enhanced live transcript with speaker labels and timestamps |
| `ResponseCard` | Streamed LLM response with react-markdown + syntax highlighting |
| `TemplateManager` | Browse, create, edit custom TOML session templates |
| `ModelSelector` | Provider/model dropdown with dynamic LM Studio model detection |
| `StatusBar` | Connection status, model, session info, cost estimate |

---

## 5. Screenpipe Integration

### What Screenpipe Handles
Screenpipe is an external process that handles the entire audio pipeline:
- **Audio device enumeration** — lists available input/output devices
- **Audio capture** — WASAPI mic + loopback capture
- **Voice Activity Detection (VAD)** — configurable sensitivity
- **Transcription** — local whisper (free) + optional Deepgram realtime (low-latency, paid)
- **Data persistence** — stores transcriptions in a local database
- **WebSocket events** — streams real-time transcription events

### Screenpipe Configuration
PRMPTR launches screenpipe with configurable flags:

```
screenpipe.exe \
  --audio-device "{selected_device} (input)" \
  --realtime-audio-device "{selected_device} (input)" \
  --enable-realtime-audio-transcription \
  --audio-transcription-engine {whisper-tiny|whisper-large-v3-turbo-quantized} \
  --deepgram-api-key "{key}" \
  --vad-sensitivity {low|medium|high} \
  --disable-vision \
  --audio-chunk-duration {5-30}
```

| Flag | Purpose | UI Control |
|------|---------|------------|
| `--audio-device` | Primary audio capture device | Dropdown (populated from `/audio/list`) |
| `--realtime-audio-device` | Device for Deepgram realtime | Same dropdown, auto-synced |
| `--enable-realtime-audio-transcription` | Enable WebSocket streaming | Toggle switch |
| `--audio-transcription-engine` | Whisper model for chunk transcription | Dropdown: tiny/large |
| `--deepgram-api-key` | Key for realtime transcription | Masked input in settings |
| `--vad-sensitivity` | Voice activity detection threshold | Dropdown: low/medium/high |
| `--disable-vision` | Skip screen capture (audio only) | Checkbox |
| `--audio-chunk-duration` | Seconds per whisper chunk | Slider (5-30s) |

### Screenpipe APIs

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `http://localhost:3030/health` | GET | Health check, version, active devices |
| `http://localhost:3030/search?content_type=audio&limit=N` | GET | Search historical transcriptions |
| `http://localhost:3030/audio/list` | GET | List available audio devices |
| `ws://localhost:3030/ws/events?images=false` | WS | Real-time transcription stream |

### WebSocket Event Format
```json
{
  "name": "transcription",
  "data": {
    "transcription": "Can you explain how React's useEffect cleanup works?",
    "timestamp": "2024-01-15T14:30:22.500Z",
    "device": "Stream Mix (Elgato Virtual Audio)",
    "speaker": 0,
    "isFinal": true
  }
}
```

### Dual Transcription Modes

| Mode | Engine | Latency | Cost | Requires |
|------|--------|---------|------|----------|
| **Chunk (default)** | Local whisper-tiny/large | ~5-30s (chunk duration) | Free | Nothing extra |
| **Realtime** | Deepgram via screenpipe | ~500ms | ~$0.0043/min | Deepgram API key + `--enable-realtime-audio-transcription` |

Both modes can run simultaneously. Chunk transcription provides the persistent searchable archive; realtime provides the low-latency stream for live assistance.

---

## 6. File Structure

### Current State (Web Prototype)

```
prmptr/
├── app/
│   ├── layout.tsx                             # Root layout — dark mode, JetBrains Mono font
│   ├── page.tsx                               # Home — QueryProvider + Dashboard
│   ├── globals.css                            # Tailwind v4 + shadcn theme (oklch colors)
│   ├── favicon.ico
│   └── api/
│       ├── stream/
│       │   └── route.ts                       # WebSocket→SSE bridge to screenpipe
│       ├── health/
│       │   └── route.ts                       # Screenpipe health proxy
│       ├── llm/
│       │   └── route.ts                       # Multi-provider LLM streaming proxy
│       └── lmstudio-test/
│           └── route.ts                       # LM Studio connection test
├── components/
│   ├── ui/                                    # shadcn/ui primitives (base-lyra style)
│   │   ├── alert-dialog.tsx
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── combobox.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── field.tsx
│   │   ├── input-group.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   ├── separator.tsx
│   │   └── textarea.tsx
│   ├── dashboard.tsx                          # Main layout + state management
│   ├── live-feed.tsx                          # Real-time transcript feed
│   ├── ai-response.tsx                        # LLM response streaming + history
│   ├── session-config.tsx                     # Session context, templates, model selector
│   ├── settings-panel.tsx                     # API keys, URLs, connection tests
│   └── query-provider.tsx                     # TanStack React Query wrapper
├── hooks/
│   └── use-screenpipe.ts                      # useScreenpipeFeed (SSE) + useScreenpipeHealth (Query)
├── lib/
│   ├── utils.ts                               # cn() utility (clsx + twMerge)
│   ├── types.ts                               # All types + model registry
│   ├── llm-providers.ts                       # Multi-provider streaming (Anthropic + OpenAI-compat)
│   ├── prompt-builder.ts                      # System prompt + user message assembly
│   └── screenpipe-client.ts                   # Screenpipe HTTP client + feed item conversion
├── docs/
│   └── PRMPTR-prd.md                          # This document
├── package.json
├── components.json                            # shadcn config (base-lyra, stone, phosphor)
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs                         # Tailwind v4 via @tailwindcss/postcss
├── eslint.config.mjs
├── next-env.d.ts
└── .env.local                                 # DEEPGRAM_API_KEY
```

### Target State (Tauri v2 Desktop App)

```
prmptr/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── screenpipe/
│       │   ├── mod.rs
│       │   ├── manager.rs                  # Process lifecycle (start/stop/restart)
│       │   ├── bridge.rs                   # WebSocket + HTTP API connection
│       │   └── config.rs                   # Launch configuration & argument builder
│       ├── transcription/
│       │   ├── mod.rs
│       │   └── transcript.rs               # Transcript data types + rolling buffer
│       ├── llm/
│       │   ├── mod.rs
│       │   ├── provider.rs                 # LlmProvider trait + unified types
│       │   ├── anthropic.rs                # Anthropic streaming client
│       │   ├── openai.rs                   # OpenAI streaming client
│       │   ├── groq.rs                     # Groq streaming client
│       │   ├── lmstudio.rs                 # LM Studio local streaming client
│       │   └── prompt_builder.rs           # System prompt assembly
│       ├── session/
│       │   ├── mod.rs
│       │   ├── manager.rs                  # Session lifecycle
│       │   ├── templates.rs                # Template loading from TOML
│       │   └── trigger.rs                  # Trigger logic
│       ├── commands.rs                     # All Tauri IPC commands
│       ├── config.rs                       # App configuration types
│       ├── state.rs                        # Shared AppState
│       └── errors.rs                       # Error types
├── app/                                    # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                            # Session start screen
│   ├── globals.css                         # Tailwind + shadcn theme
│   └── api/                                # API routes (web dev mode — retired in Tauri prod)
│       ├── stream/
│       │   └── route.ts                    # WebSocket→SSE bridge (exists, web mode only)
│       ├── health/
│       │   └── route.ts                    # Screenpipe health proxy (exists, web mode only)
│       ├── llm/
│       │   └── route.ts                    # LLM streaming proxy (exists, web mode only)
│       └── lmstudio-test/
│           └── route.ts                    # LM Studio test (exists, web mode only)
├── components/
│   ├── ui/                                 # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── textarea.tsx
│   │   ├── badge.tsx
│   │   ├── separator.tsx
│   │   ├── label.tsx
│   │   └── ...
│   ├── session/
│   │   ├── SessionStartScreen.tsx          # Main session creation UI
│   │   ├── TemplateCard.tsx                # Single template preview
│   │   ├── TemplateManager.tsx             # Browse/create templates
│   │   └── SessionControls.tsx             # In-session controls (pause, stop, etc.)
│   ├── overlay/
│   │   ├── OverlayWindow.tsx               # Overlay container
│   │   ├── ResponseCard.tsx                # AI response with markdown
│   │   └── StatusIndicator.tsx             # Status dot
│   ├── settings/
│   │   ├── SettingsPanel.tsx               # Settings container
│   │   ├── ProviderSettings.tsx            # API keys per provider
│   │   ├── ScreenpipeSettings.tsx          # Screenpipe config (devices, engine, VAD)
│   │   ├── OverlaySettings.tsx             # Overlay appearance
│   │   └── HotkeySettings.tsx              # Hotkey config
│   ├── screenpipe/
│   │   ├── ScreenpipeControls.tsx          # Start/stop, device select, realtime toggle
│   │   ├── ScreenpipeStatus.tsx            # Connection status, health info
│   │   └── AudioDeviceSelector.tsx         # Device dropdown with status indicators
│   ├── transcript/
│   │   ├── TranscriptView.tsx              # Live transcript
│   │   └── TranscriptLine.tsx              # Single line
│   ├── common/
│   │   ├── ModelSelector.tsx               # Provider + model dropdown
│   │   ├── ApiKeyInput.tsx                 # Masked key input with test button
│   │   └── HotkeyCapture.tsx              # Hotkey binding
│   └── history/
│       ├── SessionHistory.tsx              # Response history panel
│       └── HistoryItem.tsx                 # Single Q&A pair
├── stores/
│   ├── appStore.ts                         # Global app state (Zustand)
│   ├── sessionStore.ts                     # Active session state
│   ├── transcriptStore.ts                  # Transcript buffer
│   └── settingsStore.ts                    # Persisted settings
├── hooks/
│   ├── use-screenpipe.ts                   # Screenpipe feed + health hooks (exists)
│   ├── use-tauri-event.ts                  # Tauri event listener hook (new)
│   └── use-overlay-position.ts             # Overlay window position (new)
├── lib/
│   ├── utils.ts                            # shadcn utility — cn() (exists)
│   ├── types.ts                            # All types + model registry (exists)
│   ├── llm-providers.ts                    # Multi-provider streaming (exists, web mode ref)
│   ├── prompt-builder.ts                   # Prompt assembly (exists, web mode ref)
│   ├── screenpipe-client.ts                # Screenpipe HTTP client (exists, web mode ref)
│   ├── tauri-commands.ts                   # Typed IPC wrappers (new)
│   └── models.ts                           # Extended provider/model definitions (new)
├── templates/                              # Default session templates
│   ├── technical-interview.toml
│   ├── gta-rp.toml
│   ├── meeting.toml
│   ├── podcast.toml
│   ├── lecture.toml
│   └── general.toml
├── package.json
├── components.json                         # shadcn config
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs                         # Tailwind v4 via @tailwindcss/postcss
├── eslint.config.mjs
└── .env.local                              # DEEPGRAM_API_KEY, etc.
```

Note: Tailwind v4 uses CSS-based configuration (`app/globals.css` with `@theme inline`), not a `tailwind.config.ts` file. The target file structure inherits all current files plus the additions above.

---

## 7. LLM Provider Implementation

### Current TypeScript Implementation (Web Prototype)

The web prototype already has working LLM provider code in TypeScript:

- **`lib/llm-providers.ts`** — `streamLLMResponse()` async generator dispatches to `streamAnthropicResponse()` or `streamOpenAICompatibleResponse()` based on provider. OpenAI/Groq/LM Studio share the same OpenAI-compatible client with different base URLs.
- **`app/api/llm/route.ts`** — POST endpoint that creates an SSE stream, calling `streamLLMResponse()` and forwarding tokens as `{ type: "token", text }` events.
- **`lib/types.ts`** — `LLMRequest`, `StreamToken`, `ModelDef` types + `MODELS` registry + `getAvailableModels()`.

This TypeScript code serves as the reference implementation for the Rust ports below. The Rust implementations should produce identical streaming behavior.

### The `LlmProvider` Trait (Target — Rust)

```rust
// src-tauri/src/llm/provider.rs

/// Unified streaming token — all providers normalize to this
pub struct StreamToken {
    pub text: String,
    pub is_complete: bool,
    pub usage: Option<TokenUsage>,
}

pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

pub struct LlmRequest {
    pub system_prompt: String,
    pub user_message: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

/// All providers implement this trait
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Stream a response, yielding tokens as they arrive
    async fn stream_response(
        &self,
        request: LlmRequest,
        token_sender: tokio::sync::mpsc::Sender<StreamToken>,
    ) -> Result<(), LlmError>;

    /// Validate the API key / connection
    async fn validate(&self) -> Result<bool, LlmError>;

    /// Get provider name
    fn provider_name(&self) -> &str;

    /// List available models (static for cloud, dynamic for LM Studio)
    async fn list_models(&self) -> Result<Vec<String>, LlmError>;
}
```

### Provider-Specific Details

#### Anthropic Client
```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {key}
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
  { model, max_tokens, system, messages: [{role: "user", content}], stream: true }
SSE events:
  content_block_delta → delta.text
  message_stop → complete
  message_delta → usage info
```

#### OpenAI Client
```
POST https://api.openai.com/v1/chat/completions
Headers:
  Authorization: Bearer {key}
  content-type: application/json
Body:
  { model, max_tokens, messages: [{role: "system", content}, {role: "user", content}], stream: true, stream_options: { include_usage: true } }
SSE events:
  choices[0].delta.content → text
  [DONE] → complete
```

#### Groq Client
```
POST https://api.groq.com/openai/v1/chat/completions
Headers:
  Authorization: Bearer {key}
  content-type: application/json
Body:
  { model, max_tokens, messages: [{role: "system", content}, {role: "user", content}], stream: true }
SSE events:
  Same as OpenAI (Groq is OpenAI-compatible)
```

#### LM Studio Client
```
POST http://localhost:1234/v1/chat/completions
Headers:
  content-type: application/json
Body:
  { model, max_tokens, messages: [{role: "system", content}, {role: "user", content}], stream: true }
SSE events:
  Same as OpenAI (LM Studio is OpenAI-compatible)

Model discovery:
  GET http://localhost:1234/v1/models → { data: [{ id: "model-name" }] }
```

### Model Registry (Frontend)

The current implementation (`lib/types.ts`) uses a single `MODELS` array with a static `lmstudio-auto` entry for LM Studio. The target implementation splits cloud and local models, with dynamic LM Studio model fetching.

**Current implementation** (`lib/types.ts`):
```typescript
export const MODELS: ModelDef[] = [
  { id: "lmstudio-auto", name: "LM Studio (auto)", provider: "lmstudio", ... },
  // ... all cloud models
];

export function getAvailableModels(configuredProviders: LLMProvider[]): ModelDef[] {
  return MODELS.filter(m => m.provider === "lmstudio" || configuredProviders.includes(m.provider));
}
```

**Target implementation** (with dynamic LM Studio models — `lib/models.ts`):
```typescript
// lib/models.ts

export type Provider = "lmstudio" | "anthropic" | "openai" | "groq";

export interface ModelDef {
  id: string;
  name: string;
  provider: Provider;
  speed: "blazing" | "fast" | "moderate";
  description: string;
  maxTokens: number;
  costPer1kInput?: number;   // USD, for cost estimation (undefined = free/local)
  costPer1kOutput?: number;
}

// Static models for cloud providers
export const CLOUD_MODELS: ModelDef[] = [
  // Anthropic
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    speed: "fast",
    description: "Best speed/quality balance",
    maxTokens: 8192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    speed: "blazing",
    description: "Fastest, most cost-effective",
    maxTokens: 8192,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
  },
  {
    id: "claude-opus-4-5-20250918",
    name: "Claude Opus 4.5",
    provider: "anthropic",
    speed: "moderate",
    description: "Most capable, best for complex analysis",
    maxTokens: 8192,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
  },

  // OpenAI
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    speed: "fast",
    description: "Strong all-rounder",
    maxTokens: 4096,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    speed: "blazing",
    description: "Fast and affordable",
    maxTokens: 4096,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    speed: "fast",
    description: "Latest model, strong reasoning",
    maxTokens: 8192,
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    speed: "blazing",
    description: "Latest small model",
    maxTokens: 8192,
  },
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    speed: "blazing",
    description: "Ultra-fast, lowest cost",
    maxTokens: 8192,
  },

  // Groq
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    provider: "groq",
    speed: "blazing",
    description: "Fast + capable, great default",
    maxTokens: 4096,
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B",
    provider: "groq",
    speed: "blazing",
    description: "Ultra-fast simple responses",
    maxTokens: 4096,
  },
  {
    id: "llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout",
    provider: "groq",
    speed: "fast",
    description: "Newest Llama, strong reasoning",
    maxTokens: 4096,
  },
  {
    id: "mixtral-8x7b-32768",
    name: "Mixtral 8x7B",
    provider: "groq",
    speed: "blazing",
    description: "Large context window (32K)",
    maxTokens: 4096,
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B",
    provider: "groq",
    speed: "blazing",
    description: "Good quality/speed tradeoff",
    maxTokens: 4096,
  },
];

// LM Studio models are fetched dynamically
export async function fetchLmStudioModels(url: string): Promise<ModelDef[]> {
  const resp = await fetch(`${url}/v1/models`);
  const data = await resp.json();
  return data.data.map((m: { id: string }) => ({
    id: m.id,
    name: m.id,
    provider: "lmstudio" as Provider,
    speed: "fast" as const,
    description: "Local model via LM Studio",
    maxTokens: 4096,
  }));
}

// Filter to only models where the user has the provider configured
export function getAvailableModels(
  configuredProviders: Provider[],
  lmStudioModels: ModelDef[] = []
): ModelDef[] {
  const cloud = CLOUD_MODELS.filter(m => configuredProviders.includes(m.provider));
  const local = configuredProviders.includes("lmstudio") ? lmStudioModels : [];
  return [...local, ...cloud];
}
```

---

## 8. Detailed Feature Specifications

### 8.1 Audio Capture & Transcription (via Screenpipe)

PRMPTR delegates all audio capture and transcription to screenpipe:

- **Device selection**: User picks audio device from list fetched via `GET /audio/list`
- **Capture**: Screenpipe handles WASAPI mic/loopback, resampling, VAD
- **Chunk transcription**: Local whisper engine processes audio in configurable chunks (5-30s)
- **Realtime transcription**: Optional Deepgram integration for sub-second latency (requires API key)
- **Data flow**: Real-time events stream via WebSocket at `ws://localhost:3030/ws/events`

The Tauri backend manages the screenpipe process lifecycle:
- Start screenpipe with user's configured flags on app launch (or manual start)
- Monitor health via `GET /health` (every 5s)
- Restart on crash with exponential backoff
- Clean shutdown on app exit

### 8.2 Transcript Manager

- Rolling buffer: configurable window (default 2 minutes)
- Labels: speaker diarization from screenpipe events, or "Speaker N" fallback
- Silence detection: insert `[pause]` marker after 3s gap between transcriptions
- Deduplication: track event IDs to avoid duplicates
- Sentence boundary detection for clean context windows

### 8.3 Trigger System

| Mode | Behavior | Best For |
|------|----------|----------|
| **Auto** | Detects questions via keywords (who/what/when/where/why/how/can you/could you/explain/describe) and direct address. Sends last 30-60s of context. | Interviews, meetings |
| **Manual** | Global hotkey (`Ctrl+Shift+Space`) sends current buffer on demand. | Any scenario — most reliable |
| **Continuous** | Every N seconds (configurable), sends latest transcript chunk. | RP, podcasts, lectures |

- Minimum 3 seconds between LLM requests (debounce)
- New trigger cancels in-flight request if still streaming
- Queue system for rapid-fire triggers

**Current web prototype:** Only "Manual" (button click) and "Auto" (timer-based, equivalent to "Continuous" above) are implemented. Question detection requires the Rust transcript manager (Phase 4). The global hotkey requires Tauri (Phase 5).

### 8.4 Prompt Assembly

When triggered, `prompt_builder` constructs:

```
SYSTEM PROMPT:
  [BASE_INSTRUCTIONS] (always the same — "you are PRMPTR...")
  + [SESSION_CONTEXT] (what the user typed when starting the session)
  + [RESPONSE_FORMAT] (from template, if any)
  + [TRIGGER_INFO] (how this request was triggered)

USER MESSAGE:
  "Here is the recent conversation transcript:\n\n"
  + [FORMATTED_TRANSCRIPT] (with speaker labels, timestamps)
  + "\n\n---\n\n"
  + "Based on the above, provide your response."
```

### 8.5 Overlay UI

#### Window Properties
- Always on top (`WS_EX_TOPMOST`)
- Semi-transparent (configurable opacity 20-90%)
- Click-through mode (`WS_EX_TRANSPARENT` + `WS_EX_LAYERED`)
- Draggable when click-through disabled
- Position: user-configurable, default bottom-right
- Dark theme, high-contrast text
- Width: 300-600px, height: auto

#### Layout
```
┌──────────────────────────────────────┐
│ PRMPTR  [Claude Sonnet 4.5]          │  ← Status + model
│ Technical Interview                   │  ← Session context (truncated)
├──────────────────────────────────────┤
│                                      │
│  Most recent AI response streams     │
│  here with markdown + code blocks    │
│  rendered in real time...            │
│                                      │
│  ```typescript                       │
│  useEffect(() => {                   │
│    const sub = api.subscribe();      │
│    return () => sub.unsubscribe();   │
│  }, []);                             │
│  ```                                 │
│                                      │
├──────────────────────────────────────┤
│  Ctrl+Shift+Space = Ask             │
└──────────────────────────────────────┘
```

### 8.6 Settings Panel

The web prototype implements LLM provider settings and basic screenpipe connection config. The full settings panel below is the Tauri target.

**LLM Provider Settings:**
- LM Studio URL input (default `http://localhost:1234`) + connection test + auto-detect models
- Anthropic API key input (masked, with "Test" button)
- OpenAI API key input (masked, with "Test" button)
- Groq API key input (masked, with "Test" button)
- Default model selector (only shows models for configured providers)
- All cloud API keys stored in OS keychain (Windows Credential Manager)

**Screenpipe Settings:**
- Screenpipe binary path (auto-detect or manual)
- Audio device dropdown (populated from screenpipe `/audio/list`)
- Transcription engine: whisper-tiny / whisper-large-v3-turbo-quantized
- VAD sensitivity: low / medium / high
- Audio chunk duration slider (5-30s)
- Realtime transcription toggle (requires Deepgram key)
- Deepgram API key input (for realtime mode)
- Disable vision checkbox (default: on — audio only)
- Screenpipe port (default: 3030)

**Overlay Settings:**
- Opacity slider
- Position presets (corners + edges)
- Font size
- Auto-hide after N seconds
- Color theme

**Hotkeys:**
- Push-to-ask: `Ctrl+Shift+Space`
- Toggle overlay: `Ctrl+Shift+H`
- Toggle click-through: `Ctrl+Shift+C`
- End session: `Ctrl+Shift+Q`
- Clear context: `Ctrl+Shift+X`

### 8.7 System Tray
- Status icon: green (listening), yellow (processing), red (error), gray (idle)
- Right-click: Show Settings, End Session, Toggle Listening, Quit
- Left-click: toggle overlay

---

## 9. Technical Stack

### Rust Dependencies (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
reqwest = { version = "0.12", features = ["stream", "json", "native-tls"] }
futures-util = "0.3"
keyring = "3"
log = "0.4"
env_logger = "0.11"
async-trait = "0.1"
thiserror = "2"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

Note: `cpal`, `ringbuf`, `hound`, `rubato`, `dasp`, `whisper-rs` are **NOT** needed — screenpipe handles all audio capture, resampling, and transcription.

### Frontend Dependencies (package.json)

**Currently installed (web prototype):**
```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "next": "^16",
    "@base-ui/react": "^1.1.0",
    "@phosphor-icons/react": "^2.1.10",
    "@tanstack/react-query": "^5",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "shadcn": "^3",
    "tailwind-merge": "^3",
    "tw-animate-css": "^1.4.0",
    "ws": "^8"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/node": "^20",
    "@types/ws": "^8",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4",
    "eslint": "^9",
    "eslint-config-next": "^16"
  }
}
```

**Additional dependencies for Tauri (to be added):**
```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-global-shortcut": "^2",
    "@tauri-apps/plugin-store": "^2",
    "zustand": "^5",
    "react-markdown": "^9",
    "react-syntax-highlighter": "^15"
  }
}
```

### External Services
| Service | Purpose | Cost | Required? |
|---------|---------|------|-----------|
| Screenpipe | Audio capture + transcription | Free (local) | Yes |
| Deepgram | Realtime transcription via screenpipe | ~$0.0043/min | Optional (enables low-latency) |
| LM Studio | Local LLM inference | Free (local) | No (one of the LLM providers) |
| Anthropic Claude | Cloud LLM | Varies by model | No (one of the LLM providers) |
| OpenAI | Cloud LLM | Varies by model | No (one of the LLM providers) |
| Groq | Cloud LLM | Free tier available | No (one of the LLM providers) |

---

## 10. Data Flow

### Web Mode Pipeline (Current)

```
1. SCREENPIPE (external process, user-managed)
   ├─ Captures audio from selected device (WASAPI)
   ├─ Runs VAD to detect speech
   ├─ Chunk transcription via local whisper (every N seconds)
   └─ Realtime transcription via Deepgram (if enabled)

2. API ROUTE: /api/stream (Next.js server)
   ├─ Opens WebSocket to ws://localhost:3030/ws/events?images=false
   ├─ Parses event.name === "transcription" events
   ├─ Filters blank/[BLANK_AUDIO] transcriptions
   ├─ Generates unique IDs: rt-{timestamp}-{speaker}
   └─ Emits SSE events: { type: "feed", item: FeedItem }

3. BROWSER: useScreenpipeFeed() hook
   ├─ EventSource connection to /api/stream?screenpipeUrl=...
   ├─ Deduplication via seenIdsRef Set
   ├─ Appends to items state (newest first, max 200)
   └─ Feeds items to Dashboard → LiveFeed + AiResponse

4. LLM TRIGGER (auto timer or manual button click)
   ├─ AiResponse component calls /api/llm POST
   ├─ Body: { systemPrompt, userMessage, provider, model, apiKey, ... }
   └─ buildSystemPrompt() + buildUserMessage() from prompt-builder.ts

5. API ROUTE: /api/llm (Next.js server)
   ├─ streamLLMResponse() dispatches to correct provider
   ├─ Anthropic: POST /v1/messages, parse content_block_delta SSE
   ├─ OpenAI/Groq/LM Studio: POST /v1/chat/completions, parse choices[0].delta SSE
   └─ Emits SSE: { type: "token", text } ... { type: "done" }

6. BROWSER: AiResponse component
   ├─ EventSource reads token stream
   ├─ Renders incrementally with streaming cursor
   └─ Stores completed responses in history
```

### Tauri Mode Pipeline (Target)

### Real-Time Pipeline

```
1. SCREENPIPE (external process, managed by PRMPTR)
   ├─ Captures audio from selected device (WASAPI)
   ├─ Runs VAD to detect speech
   ├─ Chunk transcription via local whisper (every N seconds)
   └─ Realtime transcription via Deepgram (if enabled)

2. BRIDGE (Rust backend)
   ├─ WebSocket connection to ws://localhost:3030/ws/events
   ├─ Receives real-time transcription events
   ├─ Parses event.name === "transcription" events
   └─ Filters blank/empty transcriptions

3. BUFFER (Rust backend)
   ├─ Append to rolling transcript buffer with deduplication
   ├─ Forward to frontend via "transcript-update" event
   └─ Run trigger detection:
       ├─ Auto: question detected → FIRE
       ├─ Manual: hotkey pressed → FIRE
       └─ Continuous: interval elapsed → FIRE

4. PROMPT (on trigger)
   ├─ Assemble system prompt from session context
   ├─ Format transcript buffer as user message
   └─ Send to selected LLM provider (streaming)

5. STREAM (real-time)
   ├─ Provider client yields StreamToken events
   ├─ Forward to frontend via "response-stream" event
   └─ ResponseCard renders incrementally

6. DISPLAY
   ├─ New responses appear at top of overlay
   ├─ Previous responses scroll down / fade
   └─ Session history accumulates for review
```

### Tauri IPC Events (Target — replaces API routes in production)

```
Backend → Frontend:
  "screenpipe-status"        { running, connected, devices[], health }
  "transcript-update"        { source, speaker, text, is_final, timestamp }
  "response-stream"          { token, is_complete, provider, model }
  "response-error"           { error_message, provider }
  "status-change"            { status: listening|processing|error|idle }
  "session-started"          { session_id, context, model }
  "session-ended"            { session_id, stats }

Frontend → Backend (Commands):
  "start_screenpipe"         { config: ScreenpipeConfig }
  "stop_screenpipe"          {}
  "get_screenpipe_status"    {} → { running, connected, version }
  "get_audio_devices"        {} → device list (via screenpipe HTTP)
  "start_session"            { context, model_id, trigger_mode, settings }
  "end_session"              {}
  "trigger_ask"              {}
  "update_settings"          { settings_partial }
  "toggle_listening"         {}
  "clear_context"            {}
  "get_session_history"      {} → past responses
  "validate_api_key"         { provider, key } → bool
  "save_api_key"             { provider, key }
  "get_templates"            {} → template list
  "save_template"            { template }
  "fetch_lmstudio_models"    { url } → model list
```

---

## 11. Implementation Plan

### Phase 0: Web Prototype (COMPLETE)

All items below are implemented and working at `http://localhost:3000`.

- [x] Next.js 16 + React 19 + TypeScript project scaffolding
- [x] Tailwind CSS v4 with `@tailwindcss/postcss` (CSS-based config, no tailwind.config.ts)
- [x] shadcn/ui installation (base-lyra style, stone base color, Phosphor icons)
- [x] shadcn components: button, card, badge, input, select, textarea, separator, label, alert-dialog, combobox, dropdown-menu, field, input-group
- [x] Dark mode enabled by default (`<html className="... dark">`)
- [x] Screenpipe WebSocket→SSE bridge (`app/api/stream/route.ts`)
- [x] Screenpipe health proxy (`app/api/health/route.ts`)
- [x] Screenpipe HTTP client class (`lib/screenpipe-client.ts`)
- [x] `useScreenpipeFeed()` hook — EventSource SSE with deduplication
- [x] `useScreenpipeHealth()` hook — TanStack Query polling every 15s
- [x] Live feed component with audio/screen badges, timestamps, auto-scroll
- [x] Multi-provider LLM streaming (`lib/llm-providers.ts`) — Anthropic + OpenAI-compatible
- [x] LLM streaming API route (`app/api/llm/route.ts`)
- [x] LM Studio connection test (`app/api/lmstudio-test/route.ts`)
- [x] AI response component with streaming cursor, auto timer, manual trigger, response history
- [x] Prompt builder with session context injection (`lib/prompt-builder.ts`)
- [x] Type system + model registry (`lib/types.ts`) — LM Studio, Anthropic, OpenAI, Groq
- [x] Session config panel — templates (6 hardcoded), model selector, trigger mode, response style
- [x] Settings panel — screenpipe URL, LM Studio URL, cloud API keys with test/validation
- [x] Dashboard layout — header with connection badge, three-column layout
- [x] State persistence via localStorage (`prmptr-settings`, `prmptr-session`)
- [x] TanStack React Query for data fetching and caching

### Phase 1: Tauri v2 Setup & Screenpipe Management
- [ ] Initialize Tauri v2 in the existing Next.js project (`cargo tauri init`)
- [ ] Configure `tauri.conf.json` with two windows: `main` (normal, 800x600) + `overlay` (transparent, frameless, always-on-top, 400x500)
- [ ] All Rust dependencies in Cargo.toml (no audio crates needed)
- [ ] Screenpipe manager (Rust): locate binary, start/stop/restart process with configurable CLI flags
- [ ] Screenpipe bridge (Rust): WebSocket client for `ws://localhost:3030/ws/events`
- [ ] Screenpipe bridge (Rust): HTTP client for `/health`, `/audio/list`, `/search`
- [ ] Parse real-time transcription events, filter blanks
- [ ] Screenpipe health monitoring (poll every 5s via Rust task)
- [ ] Frontend: Screenpipe controls component (start/stop, device selector, status indicator)
- [ ] Frontend: Audio device dropdown populated from screenpipe `/audio/list`
- [ ] System tray integration with status icon
- [ ] Migrate API routes to Tauri commands (retire Next.js API routes in production)

### Phase 2: Transcription Pipeline & Enhanced Live Feed
- [ ] Transcript data structures (Rust) with source labels, speaker IDs, timestamps
- [ ] Rolling transcript buffer (configurable window, default 120s)
- [ ] Deduplication via event IDs (Rust)
- [ ] Transcript updates → frontend via Tauri `transcript-update` event
- [ ] Enhanced live transcript component with speaker diarization labels
- [ ] Screenpipe settings UI: engine selection, VAD sensitivity, chunk duration, realtime toggle
- [ ] Deepgram API key management for realtime mode

### Phase 3: LLM Integration (Rust — Multi-Provider + Local)
- [ ] `LlmProvider` Rust trait definition
- [ ] LM Studio streaming client (Rust, OpenAI-compatible at localhost:1234)
- [ ] LM Studio model auto-detection via `/v1/models` (Rust)
- [ ] Anthropic streaming client (Rust, SSE, `/v1/messages`)
- [ ] OpenAI streaming client (Rust, SSE, `/v1/chat/completions`)
- [ ] Groq streaming client (Rust, SSE, OpenAI-compatible)
- [ ] Unified `StreamToken` event → frontend via Tauri `response-stream` event
- [ ] API key storage in OS keychain (Windows Credential Manager via `keyring` crate)
- [ ] API key validation Tauri command
- [ ] Prompt builder (Rust): system prompt + transcript → LLM request
- [ ] Migrate Zustand stores from localStorage to `tauri-plugin-store`

### Phase 4: Session System
- [ ] Full-page session start screen UI (context textarea, template cards, model picker, trigger/style controls)
- [ ] Template TOML loader (Rust) — parse templates from `templates/` directory
- [ ] All 6 default TOML templates (interview, RP, meeting, podcast, lecture, general)
- [ ] Session lifecycle (start → active → end) managed in Rust
- [ ] Trigger system: manual via global hotkey (`Ctrl+Shift+Space`)
- [ ] Trigger system: auto question detection (keyword matching in transcript)
- [ ] Trigger system: continuous interval (configurable, 8-120s)
- [ ] Debounce (min 3s between requests) & in-flight request cancellation
- [ ] Session history accumulation with response metadata

### Phase 5: Overlay & Polish
- [ ] Overlay window: always-on-top (`WS_EX_TOPMOST`), transparent, click-through (`WS_EX_TRANSPARENT`)
- [ ] Overlay positioning + dragging when click-through disabled
- [ ] Response streaming display with `react-markdown` + `react-syntax-highlighter`
- [ ] Global hotkeys: push-to-ask, toggle overlay, toggle click-through, end session, clear context
- [ ] Settings persistence via `tauri-plugin-store`
- [ ] Cost estimation display (input/output tokens * model pricing)
- [ ] Error handling + screenpipe auto-reconnection with exponential backoff
- [ ] Tray icon status colors (green/yellow/red/gray)
- [ ] Template manager UI (create/edit custom TOML templates)
- [ ] Session stats on end (duration, tokens used, estimated cost)

### Phase 6: Enhancements (Post-MVP)
- [ ] Screenshot + OCR for visual context (Claude/GPT-4o vision, re-enable `--enable-vision`)
- [ ] TTS for suggested dialogue (RP use case)
- [ ] Export session transcripts + responses
- [ ] Multi-monitor overlay support
- [ ] Custom hotkey binding UI
- [ ] Session auto-save and resume
- [ ] Ollama provider for fully local operation (alternative to LM Studio)
- [ ] Multiple simultaneous audio devices

---

## 12. Claude Code Build Prompt

Copy everything between `---START---` and `---END---` and send to Claude Code along with this full PRD document as context.

---START---

Wrap the existing PRMPTR web prototype in a **Tauri v2** desktop application for Windows. The web prototype is already functional — it uses Next.js API routes to bridge the browser to screenpipe and LLM providers. The Tauri migration moves the server-side logic into Rust and adds native desktop features (overlay window, global hotkeys, system tray, keychain storage).

**What already exists (DO NOT rebuild):**
The project root is a working Next.js 16 + React 19 + Tailwind v4 + shadcn/ui (base-lyra style, stone base color, Phosphor icons) application with:
- Real-time audio feed via screenpipe WebSocket→SSE bridge (`app/api/stream/route.ts`)
- Multi-provider LLM streaming — Anthropic, OpenAI, Groq, LM Studio local (`lib/llm-providers.ts`, `app/api/llm/route.ts`)
- Session configuration with 6 hardcoded templates, model selector, trigger modes (`components/session-config.tsx`)
- Settings panel with API key management and connection testing (`components/settings-panel.tsx`)
- Dashboard layout with live feed, AI response, and config panels (`components/dashboard.tsx`)
- Type system + model registry (`lib/types.ts`), prompt builder (`lib/prompt-builder.ts`), screenpipe client (`lib/screenpipe-client.ts`)
- TanStack React Query for data fetching, localStorage for persistence
- 13 shadcn/ui components installed (button, card, badge, input, select, textarea, separator, label, alert-dialog, combobox, dropdown-menu, field, input-group)

**Core concept:** PRMPTR is session-based. When the user starts a session, they describe what they're listening to in plain text (or pick a template). This context drives the LLM's system prompt. It's NOT limited to specific modes — the user can describe any listening scenario.

**Key architecture decision — Screenpipe handles audio:**
PRMPTR does NOT capture audio or run transcription directly. Instead, it manages a screenpipe process that handles:
- WASAPI audio device capture (mic + system audio)
- Voice Activity Detection (VAD)
- Transcription via local whisper (free) or Deepgram realtime (low-latency, paid)

PRMPTR connects to screenpipe via:
- **WebSocket** (`ws://localhost:3030/ws/events`) for real-time transcription events
- **HTTP API** (`http://localhost:3030`) for health checks, device listing, historical search

Proven working screenpipe configuration:
```
screenpipe.exe \
  --audio-device "Stream Mix (Elgato Virtual Audio) (input)" \
  --realtime-audio-device "Stream Mix (Elgato Virtual Audio) (input)" \
  --enable-realtime-audio-transcription \
  --audio-transcription-engine whisper-tiny \
  --deepgram-api-key "{key}" \
  --vad-sensitivity low \
  --disable-vision \
  --audio-chunk-duration 5
```

**Tech stack (Tauri layer):**
- Tauri v2 (Rust backend)
- tokio-tungstenite for screenpipe WebSocket connection
- reqwest for screenpipe HTTP API + LLM API streaming
- tauri-plugin-global-shortcut for hotkeys
- tauri-plugin-store for settings persistence
- keyring crate for secure API key storage in Windows Credential Manager
- NO audio crates — no cpal, no ringbuf, no hound, no rubato, no whisper-rs

**Tech stack (frontend — already in place):**
- Next.js 16 + React 19 + TypeScript
- Tailwind CSS v4 (CSS-based config via `@tailwindcss/postcss`, no tailwind.config.ts)
- shadcn/ui (base-lyra style, stone base color, Phosphor icons)
- @tanstack/react-query for data fetching
- ws for server-side WebSocket (used in API route bridge)

**New dependencies to add for Tauri:**
- @tauri-apps/api, @tauri-apps/plugin-global-shortcut, @tauri-apps/plugin-store
- zustand v5 (replace localStorage state with proper stores)
- react-markdown + react-syntax-highlighter (for overlay response rendering)

**Multi-provider LLM support (already working in TypeScript, migrate to Rust):**
The web prototype already has working TypeScript implementations in `lib/llm-providers.ts`. The Tauri migration creates Rust equivalents:

1. LmStudioClient — POST to `http://localhost:1234/v1/chat/completions`, no auth, `stream: true`. Auto-detect models via `GET /v1/models`.
2. AnthropicClient — POST to `https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `stream: true`. Parse `content_block_delta` SSE.
3. OpenAIClient — POST to `https://api.openai.com/v1/chat/completions` with `Bearer {key}`, `stream: true`. Parse `choices[0].delta.content` SSE.
4. GroqClient — POST to `https://api.groq.com/openai/v1/chat/completions` with `Bearer {key}`, `stream: true`. Same SSE as OpenAI.

All normalize to `StreamToken { text, is_complete, usage }` via Tauri events.

**Supported models:**
- LM Studio: dynamically fetched from `GET /v1/models` endpoint
- Anthropic: claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001, claude-opus-4-5-20250918
- OpenAI: gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
- Groq: llama-3.3-70b-versatile, llama-3.1-8b-instant, llama-4-scout-17b-16e-instruct, mixtral-8x7b-32768, gemma2-9b-it

Note: The current web prototype model registry (`lib/types.ts`) implements a subset — Claude Opus 4.5, GPT-4.1 Nano, Llama 4 Scout, and Gemma 2 9B are defined in the PRD but not yet in the code. Add them during the Tauri migration.

**Build order:**

STEP 1 — Scaffold Tauri v2 wrapping the EXISTING Next.js app:
- Run `cargo tauri init` in the project root (the Next.js app already exists)
- Configure tauri.conf.json: two windows — `main` (normal, 800x600) and `overlay` (transparent, frameless, always-on-top, 400x500)
- Add all Rust dependencies from PRD Section 9 to Cargo.toml
- Verify the existing web app still boots: `cargo tauri dev`
- The existing React components continue to work — Tauri wraps them

STEP 2 — Screenpipe process management (Rust):
- Screenpipe manager: find binary (check PATH, common install locations, user config), start/stop process with configurable CLI flags
- Screenpipe bridge: WebSocket client to `ws://localhost:3030/ws/events`
- Screenpipe bridge: HTTP client for `/health`, `/audio/list`, `/search`
- Parse transcription events from WebSocket, filter blanks/[BLANK_AUDIO]
- Health monitoring loop (poll `/health` every 5s)
- Tauri commands: start_screenpipe, stop_screenpipe, get_screenpipe_status, get_audio_devices
- Frontend: Replace existing connection-status badge with screenpipe controls component (start/stop, device selector)

STEP 3 — Transcription pipeline (Rust):
- Transcript data structures with timestamps, speaker labels, source, event IDs
- Rolling buffer (configurable window, default 120s) with deduplication
- Forward to frontend via Tauri `transcript-update` event (replaces SSE bridge)
- Trigger detection: auto (question keywords), manual (hotkey), continuous (interval)
- Debounce: min 3s between requests, cancel in-flight on new trigger

STEP 4 — LLM providers (Rust):
- `LlmProvider` trait + LmStudioClient + AnthropicClient + OpenAIClient + GroqClient
- Port the streaming logic from `lib/llm-providers.ts` to Rust equivalents
- Stream responses via Tauri `response-stream` event (replaces SSE /api/llm route)
- LM Studio model auto-detection via `/v1/models`
- Prompt builder (port from `lib/prompt-builder.ts`): base instructions + session context + transcript
- Commands: validate_api_key, save_api_key (keyring), start_session, end_session, trigger_ask, fetch_lmstudio_models
- Retire Next.js API routes (`app/api/`) — all logic now in Rust

STEP 5 — Enhanced React UI:
- Full-page session start screen (replace compact session-config panel)
- Screenpipe controls component (start/stop, device selector, realtime toggle, engine picker, status)
- Overlay window page (transparent, streamed responses with react-markdown + react-syntax-highlighter)
- Enhanced live transcript with speaker labels and diarization
- Model selector with dynamic LM Studio model list (grouped by provider)
- Session history panel with expandable Q&A pairs
- System tray with status icon
- Zustand stores (replace localStorage state management)

STEP 6 — Hotkeys & polish:
- Global hotkeys: Ctrl+Shift+Space (ask), Ctrl+Shift+H (toggle overlay), Ctrl+Shift+C (click-through), Ctrl+Shift+Q (end session)
- Settings persistence via tauri-plugin-store
- Cloud API keys in OS keychain (keyring crate, Windows Credential Manager)
- Screenpipe auto-reconnection with exponential backoff
- Error handling with user-friendly inline messages
- Tray icon status colors (green=listening, yellow=processing, red=error, gray=idle)
- Template manager UI (create/edit custom TOML templates)

**Critical implementation notes:**
- Screenpipe binary location: check common paths (PATH, `~/screenpipe/bin/`, `C:\Users\{user}\screenpipe\bin\`), or let user configure in settings
- Screenpipe device names MUST include `(input)` or `(output)` suffix — e.g. `"Stream Mix (Elgato Virtual Audio) (input)"`
- `whisper-tiny` is recommended over `whisper-large-v3-turbo-quantized` — the large model can crash with certain audio device formats
- Realtime transcription requires Deepgram API key + `--enable-realtime-audio-transcription` flag
- WebSocket events have format: `{ name: "transcription", data: { transcription, timestamp, device, speaker, isFinal } }`
- Filter out blank transcriptions and `[BLANK_AUDIO]` markers
- LM Studio is OpenAI-compatible — same client with `http://localhost:1234` base URL and no auth
- Groq is OpenAI-compatible — same client with `https://api.groq.com/openai` base URL
- Cloud API keys stored in Windows Credential Manager via keyring crate, NEVER in plain text
- Overlay: WS_EX_TOPMOST + WS_EX_TRANSPARENT + WS_EX_LAYERED. Games must be in borderless windowed mode.
- The frontend uses shadcn/ui with base-lyra style, stone base color, Phosphor icons — Tailwind v4 uses CSS-based config (no tailwind.config.ts)
- The existing TypeScript implementations in `lib/` serve as reference for the Rust ports — same API contracts, same streaming behavior

---END---

---

## 13. Open Questions / Future Considerations

1. **Screenpipe bundling:** Should PRMPTR bundle screenpipe.exe or require the user to install it separately? Bundling simplifies setup but increases package size.
2. **Vision context:** Screenpipe also supports screen capture — could enable sending screenshots to vision-capable models for richer context (re-enable with `--enable-vision`)
3. **Ollama provider:** Add Ollama as another local LLM option alongside LM Studio
4. **Plugin system:** Let users write custom trigger logic or post-processing
5. **Privacy mode:** All-local processing (whisper-tiny + LM Studio/Ollama) with zero cloud calls
6. **Mobile companion:** Send responses to phone overlay for in-person meetings
7. **Multi-language:** Screenpipe/Deepgram support many languages — add language selection in settings
8. **Recording:** Screenpipe already persists transcriptions — add UI to browse/export session history
9. **Speaker diarization:** Screenpipe provides basic speaker IDs — could enhance with speaker name assignment in the UI
10. **Multiple audio devices:** Screenpipe supports `--audio-device` multiple times — could capture from multiple sources simultaneously
11. **Web mode retention:** Keep the Next.js API routes functional even after Tauri migration, allowing PRMPTR to run as a web app for users who don't need native features
12. **Linux/macOS support:** Screenpipe supports PulseAudio/CoreAudio — PRMPTR could extend beyond Windows with platform-specific screenpipe configs
