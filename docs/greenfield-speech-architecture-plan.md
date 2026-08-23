# PRMPTR Greenfield Speech Architecture Plan

Status: **ACTIVE EXECUTION PLAN**  
Branch: `feature/greenfield-speech-core`  
Priority order: **P0 → P1 → P2**  
Primary objective: make PRMPTR's live transcription stack as accurate, low-latency, speaker-aware, resilient, locally private, and cross-platform as practical while keeping the application shell maintainable.

---

## 1. Definition of Done

This plan is not complete when APIs or scaffolds exist. A capability is complete only when the shipping path is implemented, connected end-to-end, covered by automated tests where practical, and validated on the platforms for which evidence exists.

PRMPTR should ultimately provide:

- first-class local streaming transcription rather than repeated batch transcription of VAD chunks;
- speaker diarization **enabled by default** with an explicit opt-out;
- stable speaker-aware transcript lines that can be revised without duplication;
- word-level timing and confidence when the active engine exposes them;
- independent microphone (`YOU`) and system-audio (`THEM`) tracks;
- strong protection against system-audio leakage being mislabeled as the user;
- adaptive selection of the highest-quality local speech model the machine can sustain in real time;
- runtime contextual biasing from session context, OCR, visible names, technical symbols, and user vocabulary;
- one canonical transcript model shared by native runtime, frontend, persistence, and LLM prompting;
- correct native capture on Windows, macOS, and Linux, with explicit capability reporting rather than silent degradation;
- measurable accuracy, diarization quality, latency, clipping, and stability through a repeatable PRMPTR speech benchmark;
- diagnostic evidence sufficient to debug what audio the model actually received and why a transcript was produced;
- clean backend boundaries that allow Moonshine, Whisper, Deepgram, or future engines to implement one contract without duplicating audio capture and transcript logic.

The goal is not merely a lower word error rate. The product must preserve **who said what, when they said it, how certain the engine was, which source produced it, and whether the line later changed**.

---

## 2. Non-Negotiable Architecture Rules

1. **Capture is not transcription.** Audio-device discovery, capture, conditioning, clocks, echo handling, buffering, and backpressure belong below STT engines.
2. **STT engines do not own UI models.** Engines emit a canonical native transcript event contract.
3. **Stable IDs are revision keys.** A revised line updates the same logical transcript line instead of creating duplicates.
4. **Microphone topology is authoritative for `YOU`.** Speaker diarization must never relabel the configured user microphone as an anonymous remote speaker.
5. **Speaker identity is stream-scoped.** IDs must be namespaced by audio track unless an explicit cross-stream identity layer is introduced later.
6. **Diarization defaults ON.** Users may disable it, and disabling it must remove recurring diarization inference cost without requiring a full application restart.
7. **No silent platform fallbacks.** Unsupported system-audio capture, missing permissions, failed models, device loss, or degraded engines must be observable in capability/status APIs and UI.
8. **No phrase blacklists as a substitute for confidence.** Legitimate words such as `you`, `the`, or `thank you` must not be discarded merely because they resemble hallucination artifacts.
9. **No invisible LLM transcript rewriting.** If a secondary verifier changes recognized text, retain provenance and expose deterministic reconciliation rather than silently replacing speech with generated prose.
10. **Accuracy changes require evidence.** Important segmentation/model/context changes must be compared against the PRMPTR benchmark corpus.
11. **Cross-platform code is physically separated where the OS implementation differs.** Shared protocol/state stays platform neutral; OS capture implementations stay under explicit platform modules.
12. **Shipping paths cannot depend on debug-only behavior.** Diagnostics may add evidence, but production correctness cannot require MCP/dev instrumentation.

---

## 3. Target Architecture

```text
                             ┌────────────────────┐
                             │ Session / UI State │
                             └─────────┬──────────┘
                                       │
                  ┌────────────────────▼────────────────────┐
                  │          Speech Orchestrator            │
                  │ lifecycle / capabilities / health       │
                  └───────┬───────────────────────┬─────────┘
                          │                       │
             ┌────────────▼──────────┐ ┌──────────▼────────────┐
             │ microphone track      │ │ system-output track   │
             │ authoritative YOU     │ │ authoritative THEM    │
             └────────────┬──────────┘ └──────────┬────────────┘
                          │                       │
                  ┌───────▼───────────────────────▼───────┐
                  │             Audio Core                │
                  │ capture / format / resample / clock   │
                  │ ring queue / metrics / AEC reference  │
                  └──────────────────┬────────────────────┘
                                     │
                         ┌───────────▼───────────┐
                         │    STT Engine API      │
                         │ Moonshine first-class  │
                         │ Whisper / Deepgram     │
                         └───────────┬───────────┘
                                     │
          OCR / session context ─────┤
          glossary / app metadata ───┤ Context Bias Manager
                                     │
                         ┌───────────▼────────────┐
                         │ Canonical Transcript   │
                         │ reducer / revisions    │
                         │ words / speakers       │
                         │ confidence / timing    │
                         └───────┬───────┬────────┘
                                 │       │
                         ┌───────▼───┐ ┌─▼───────────┐
                         │ frontend  │ │ persistence │
                         └───────┬───┘ └─┬───────────┘
                                 │       │
                                 └───┬───┘
                                     │
                              ┌──────▼──────┐
                              │ LLM context │
                              └─────────────┘
```

### Proposed native module layout

```text
src-tauri/src/speech/
  mod.rs
  orchestrator.rs
  capabilities.rs
  diagnostics.rs

  audio/
    mod.rs
    device.rs
    conditioner.rs
    clock.rs
    queue.rs
    metrics.rs
    echo.rs
    platform/
      windows.rs
      macos.rs
      linux.rs

  transcript/
    mod.rs
    model.rs
    reducer.rs
    speaker.rs

  context/
    mod.rs
    bias.rs
    keyterms.rs

  engines/
    mod.rs
    moonshine.rs
    whisper.rs
    deepgram.rs
```

Names may evolve, but the ownership boundaries should not.

---

## 4. Canonical Transcript Contract

The current feed-oriented model is too small for modern streaming STT. Introduce a canonical native line model and project it into UI feed items only at the edge.

Illustrative TypeScript shape:

```ts
export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface SpeakerSpan {
  speakerKey: string;      // e.g. system:1
  speakerIndex: number;
  label?: string;          // e.g. Speaker 1 / Sarah
  startMs: number;
  endMs: number;
  startChar?: number;
  endChar?: number;
}

export interface TranscriptLine {
  id: string;
  revision: number;
  trackId: "mic" | "system";
  role: "you" | "them" | "unknown";
  engine: string;
  model: string;
  modelVersion?: string;
  text: string;
  startMs: number;
  endMs: number;
  isComplete: boolean;
  words: TranscriptWord[];
  speakerSpans: SpeakerSpan[];
  latencyMs?: number;
  createdAt: string;
  updatedAt: string;
}
```

Required semantics:

- `id` is stable across text/speaker revisions.
- `revision` increases monotonically.
- incomplete lines may render but must not be persisted as duplicate final lines.
- speaker-only updates are valid revisions even when text is unchanged.
- native timestamps come from the audio clock, not merely wall-clock processing completion.
- persistence keeps engine/model provenance.
- LLM prompt construction consumes canonical transcript roles/speakers rather than guessing ownership from display strings.

---

# P0 — Correctness, Contract, Evidence, and Cross-Platform Foundations

P0 items block trustworthy higher-level work.

## P0.1 Preserve speaker identity end-to-end

**Status: implementation started on `feature/greenfield-speech-core`.**

Requirements:

- native `speaker_id` / `speaker_label` reach React;
- speaker identity survives persistence and session reload;
- native `deviceType` is authoritative for `YOU` / `THEM` prompt roles;
- output diarization becomes `[THEM: Speaker N]` or a renamed label in LLM context;
- microphone remains `[YOU]` regardless of speaker embedding result;
- prompt delimiter labels are sanitized.

Acceptance:

- unit tests prove mic/output/unknown labeling and speaker suffixes;
- saved sessions retain labels after reload;
- no intermediate adapter intentionally drops speaker metadata.

## P0.2 Diarization defaults ON with explicit live opt-out

**Status: implementation started on `feature/greenfield-speech-core`.**

Requirements:

- default behavior is enabled with no prior preference;
- user can disable/enable without application restart;
- native diarization inference checks the live flag before embedding work;
- UI clearly indicates current state;
- preference persists across launches;
- future Moonshine-native diarization uses the same product preference.

Acceptance:

- default parser test = enabled;
- native getter/setter returns effective state;
- toggling off stops newly emitted speaker metadata without stopping transcription;
- toggling back on resumes speaker assignment.

## P0.3 Introduce the canonical transcript model and revision reducer

Replace `FeedItem` as the internal speech truth.

Tasks:

- define Rust transcript line/word/span structs;
- define revision/update semantics;
- change native coordinator from append-only final entries to update-or-insert;
- add serialization tests;
- add TS mirror/types generated or centrally maintained with drift protection;
- project transcript lines into `FeedItem` only for legacy/display paths;
- store canonical transcript lines in IndexedDB with a schema migration;
- preserve old saved sessions through migration/fallback conversion.

Acceptance:

- same line ID can receive text update, speaker-only update, then finalization without duplication;
- reload returns identical speaker/timing/provenance metadata;
- LLM context uses the newest revision only.

## P0.4 Remove correctness-damaging artifact blacklists

Current STT code suppresses exact common phrases in an attempt to reject hallucinations.

Tasks:

- remove hard-coded rejection of legitimate short/common phrases;
- retain only explicit model control tokens / known non-speech markers that cannot be valid user speech;
- use VAD, completion state, confidence, duration, and benchmark evidence for filtering;
- log filtered events with reason in diagnostics mode.

Acceptance:

- corpus fixtures containing legitimate `you`, `the`, `thank you`, etc. survive;
- known explicit non-speech tokens remain filtered;
- tests cover both sides.

## P0.5 Separate audio capture/conditioning from STT engines

Current local and cloud paths duplicate device/capture concerns.

Tasks:

- define `AudioTrack`, `AudioChunk`, `AudioFormat`, and monotonic sample-clock metadata;
- capture native format once;
- perform channel conversion once;
- resample once per consumer requirement;
- feed engine queues rather than letting engines own OS devices;
- provide bounded queues and dropped-sample counters;
- expose track health and device identity.

Acceptance:

- Whisper, Moonshine, and Deepgram can consume the same conditioned track API;
- no STT backend opens its own microphone/system device;
- buffer overruns are measurable rather than silent.

## P0.6 Replace linear resampling and stereo assumptions

Tasks:

- replace the current linear interpolator with a production-quality bandlimited/polyphase resampler (Rubato or equivalent);
- handle arbitrary channel counts rather than pairs-only stereo averaging;
- normalize integer/float input formats supported by the platform capture API;
- add deterministic resampler/channel-mix unit tests;
- benchmark cost at common 44.1/48 kHz inputs to 16 kHz mono.

Acceptance:

- mono/stereo/multichannel fixtures produce correct lengths and bounded amplitudes;
- long-running sample-clock drift stays within defined tolerance;
- no panics on odd sample counts/channel layouts.

## P0.7 Establish truthful cross-platform capture capabilities

The current path explicitly skips output capture outside Windows. Greenfield must make this a first-class platform concern.

### Windows

- WASAPI microphone capture;
- WASAPI loopback system-output capture;
- stable endpoint identity;
- device loss/reconnect handling;
- permission/error reporting.

### macOS

- microphone through CoreAudio/cpal where appropriate;
- system audio through ScreenCaptureKit/CoreAudio-compatible native implementation;
- required permissions surfaced clearly;
- device/default-route change handling.

### Linux

- microphone through PipeWire/Pulse-compatible path;
- system output through PipeWire/Pulse monitor/node capture;
- capability discovery instead of assuming monitor availability;
- device/default-route change handling.

Acceptance:

- a capability API reports `micCapture`, `systemCapture`, selected backend, permissions, and errors;
- unsupported/unavailable output capture is shown to the user and never silently presented as active;
- exact runtime evidence is required before marking each platform PASS.

## P0.8 Add the PRMPTR speech benchmark harness

Create a repeatable local benchmark before large tuning work.

Corpus categories:

- clean headset microphone;
- laptop microphone;
- room echo;
- fan/background noise;
- quiet speech/whispering;
- fast speech;
- multiple accents;
- Discord/Zoom/Meet-style compressed speech;
- background music/game audio;
- technical interview speech;
- coding identifiers / package names / URLs / numbers;
- 2, 3, and 5 speaker conversations;
- rapid turn-taking;
- overlapping speech;
- intentional short utterances;
- dual mic + system recordings with speaker leakage.

Metrics:

- WER / CER;
- named-entity and technical-term error rate;
- speaker diarization error rate;
- speaker-change boundary error;
- duplicate cross-channel transcript rate;
- first-word clipping rate;
- last-word clipping rate;
- partial hypothesis churn;
- end-of-turn latency;
- model inference p50/p95;
- real-time factor;
- dropped samples/queue overruns;
- CPU/RAM/GPU usage.

Acceptance:

- one command produces machine-readable JSON plus a human summary;
- benchmark inputs are versioned or deterministically referenced;
- model/config metadata is included in every result;
- future speech changes can compare before/after results.

## P0.9 Add native diagnostics and observability

Tasks:

- track input sample count, output sample count, queue depth, overruns, VAD state, inference duration, transcript revisions, and diarization duration;
- optional audio dump of exactly what STT receives;
- optional structured speech event log;
- redact/disable diagnostics by default where privacy requires it;
- expose a diagnostic bundle command for bug reports.

Acceptance:

- a bad transcription can be traced to its conditioned audio and engine metadata in diagnostics mode;
- normal mode does not retain raw audio unexpectedly.

## P0.10 Make local engine naming backend-neutral

Tasks:

- retire `WhisperStreamManager` / `LocalWhisperConfig` naming from shared orchestration;
- introduce engine-neutral `SpeechStreamManager` / `LocalSpeechConfig` or equivalent;
- keep backend-specific names only inside engine modules;
- preserve command compatibility temporarily with deprecated wrappers if migration needs it.

Acceptance:

- Moonshine is not represented as a boolean subtype of Whisper in the new API;
- selecting a backend is an enum/engine ID with validated backend-specific configuration.

---

# P1 — Moonshine Voice First-Class Streaming and Accuracy Features

## P1.1 Replace legacy sherpa Moonshine batch path with current Moonshine Voice streaming

The existing `sherpa-rs` Moonshine Base path is useful as a baseline but should not be the greenfield primary Moonshine implementation.

Engineering spike:

1. evaluate `moonshine-rs` as a thin Rust wrapper over Moonshine Voice's C API;
2. verify supported OS/architectures, library packaging, model download behavior, licensing, ABI stability, panic/error handling, and Tauri bundling;
3. pin an exact known-good version if adopted;
4. if it is too immature or packaging-invalid, implement a PRMPTR-owned minimal safe wrapper over the official Moonshine C ABI using the same engine contract;
5. do not build higher layers on an integration that fails packaging/runtime validation.

Required engine features:

- native streaming accept/decode flow;
- stable transcript line IDs;
- incomplete + complete lines;
- speaker spans;
- speaker revision notifications;
- word timestamps;
- word confidence;
- inference latency;
- runtime context/keyterms;
- model selection;
- graceful shutdown/flush.

Acceptance:

- streaming path is exercised end-to-end through the shipping Tauri command/event surface;
- a line may be revised without UI duplication;
- diarization works through the same default-on preference;
- model/runtime errors propagate to status UI;
- fallback to another engine is explicit, not silent.

## P1.2 Model-quality auto selection

Expose product-level modes rather than raw model trivia:

- `Auto` (default);
- `Maximum accuracy`;
- `Balanced`;
- `Low CPU`.

Auto-selection should benchmark sustained real-time behavior with diarization/context features enabled and choose the largest model that remains inside latency/real-time limits.

Tasks:

- support current Moonshine streaming model catalog;
- cache benchmark/capability result per machine/model version;
- re-evaluate when runtime/model version changes;
- allow manual override;
- never silently disable diarization just to pass real time unless the user chose that tradeoff.

Acceptance:

- selected model/reason is visible in diagnostics/status;
- overload results in controlled model downgrade or backpressure policy, not dropped mystery audio.

## P1.3 Span-based diarization and retroactive speaker correction

Move beyond one-speaker-per-VAD-segment assignment.

Tasks:

- consume Moonshine speaker spans;
- split/render multi-speaker lines correctly;
- apply `have_speakers_changed`/equivalent revisions to existing lines;
- namespace identities by track (`system:1`, etc.);
- retain user-renamed labels separately from raw engine speaker indexes;
- when a speaker revision merges/splits identities, update affected lines deterministically.

Acceptance:

- a line containing a speaker transition can display more than one speaker span;
- previous rendered lines update when the engine revises speaker identity;
- no duplicate LLM context is introduced by speaker-only revisions.

## P1.4 Speaker naming UX

Tasks:

- click/tap a speaker label to rename within a session;
- persist session-level mapping;
- preserve raw speaker key separately;
- optional `Speaker 1`, `Speaker 2`, etc. defaults;
- microphone remains `You` by topology;
- expose reset/merge controls only if they can be made predictable.

Acceptance:

- renamed participant appears consistently in feed, history, export, and LLM context;
- renaming does not mutate the underlying engine speaker key.

## P1.5 Screen-aware Context Bias Manager

This is a core PRMPTR differentiator.

Inputs:

- explicit session context;
- current app/window title;
- recent OCR;
- visible participant/product/company names;
- coding identifiers and symbols;
- user vocabulary/glossary;
- recently confirmed unusual terms;
- optional template-specific vocabulary.

Pipeline:

1. normalize OCR without destroying identifiers;
2. extract candidate unusual terms/names;
3. rank by recency, repetition, casing, lexical rarity, and session relevance;
4. dedupe;
5. cap the active set;
6. push changes through Moonshine runtime `keyterms` / `context` APIs without restarting streams.

Guardrails:

- do not feed giant raw OCR dumps;
- avoid biasing toward stale terms;
- sanitize untrusted screen text before it enters any prompt-like context channel;
- keep a diagnostics view of active keyterms/context.

Acceptance:

- benchmark technical names/identifiers with bias on vs off;
- material entity error-rate improvement is required to keep aggressive heuristics;
- live screen changes update context without interrupting transcription.

## P1.6 User glossary

Tasks:

- allow persistent terms, names, acronyms, product names, gaming terms, repo names, etc.;
- optionally scope entries globally or per session/template;
- feed glossary into Context Bias Manager;
- allow quick “correct spelling / remember this term” action from transcript UI.

Acceptance:

- glossary survives restart;
- edits update active local streaming context live.

## P1.7 Acoustic echo cancellation / cross-track dedupe

PRMPTR has a unique dual-track problem: system output may leak into the microphone and become false `[YOU]` speech.

Tasks:

- evaluate WebRTC Audio Processing or an equivalent native AEC implementation;
- use system-output audio as the microphone echo reference;
- retain an option to disable processing for already-clean/headphone setups;
- add a secondary temporal/text cross-track duplicate detector as a safety signal, not a replacement for AEC;
- instrument duplicate cross-channel rate.

Acceptance:

- benchmark speaker playback into an open microphone before/after;
- meaningful reduction in false `[YOU]` duplicates without materially damaging user speech WER.

## P1.8 Turn-state / endpointing model

With true streaming events, remove assumptions built around fixed 900 ms silence waits and forced nine-second utterance chunks where possible.

Tasks:

- use engine completion state/endpointer when reliable;
- retain bounded fallback endpointing for engines lacking it;
- expose per-track speaking/idle state;
- distinguish “partial line changed” from “turn ended”;
- feed turn completion to smart-trigger logic.

Acceptance:

- shorter perceived response latency with no increase in clipped final words;
- long speakers do not get arbitrary semantic breaks solely because a timer expired.

## P1.9 Smarter LLM conversation structure

Tasks:

- build context from canonical transcript roles and speaker labels;
- preserve turn boundaries and ordering by audio clock;
- include confidence selectively rather than flooding prompts;
- smart trigger recognizes `THEM: Sarah asked YOU`, speaker stopped, and user has not answered;
- reduce OCR/transcript duplication in prompt budget;
- never use stale revisions.

Acceptance:

- multi-speaker test fixtures retain participant identity in analysis/chat/gate prompts;
- revisions replace prior text rather than duplicating it.

## P1.10 Cross-platform runtime parity gate

For Windows/macOS/Linux, retain a parity matrix covering:

- input device enumeration;
- output device enumeration;
- microphone capture;
- system-output capture;
- live mute;
- device switch;
- device disconnect/reconnect;
- Moonshine streaming;
- diarization;
- context updates;
- model download/cache;
- stop/flush/restart;
- diagnostics;
- persisted sessions.

Use `PASS`, `FAIL`, or `NOT TESTED`. Do not infer runtime PASS from compilation alone.

---

# P2 — Verification, Adaptation, Product Polish, and Secondary Consolidation

## P2.1 Confidence-driven verifier

Do not run two expensive STT engines on everything by default.

Tasks:

- define suspicious-line criteria using low word confidence, high churn, implausible token patterns, entity uncertainty, or clipping evidence;
- retain the relevant buffered final audio for a short bounded period;
- optionally re-run suspicious completed lines through a verifier (e.g. stronger Whisper or permitted cloud engine);
- align verifier words to primary result;
- apply deterministic reconciliation rules;
- retain both engine results/provenance in diagnostics.

Acceptance:

- verifier materially reduces benchmark errors on selected lines;
- latency/cost stays bounded because high-confidence lines bypass it;
- no LLM-generated “correction” is silently substituted for STT evidence.

## P2.2 Domain adaptation / LoRA evaluation

Only after baseline/context-bias work is measured.

Candidate domains:

- software engineering / coding interviews;
- livestream/gaming terminology;
- user-specific accents or repeated vocabulary if enough consented data exists.

Acceptance:

- held-out benchmark improvement versus base model;
- no unacceptable regression on general speech;
- adapter provenance/version recorded;
- runtime keyterms remain composable with adaptation.

## P2.3 Noise suppression / AGC evaluation

Treat preprocessing as a measured feature, not a universal improvement.

Tasks:

- benchmark clean vs noisy inputs;
- provide `Auto`, `Off`, and possibly advanced controls;
- avoid aggressive processing when input is already clean;
- record active processing chain in diagnostics.

Acceptance:

- enabled modes demonstrate benchmark benefit for their intended conditions.

## P2.4 Transcript inspection UI

Optional advanced view:

- word confidence;
- word timestamps;
- speaker spans;
- line revision history;
- engine/model identity;
- latency;
- active context/keyterms at recognition time;
- “report bad transcript” export for local diagnostics.

Keep the default feed visually simple.

## P2.5 Export and session fidelity

Tasks:

- plain text export with speaker names;
- JSON canonical transcript export;
- SRT/VTT where timing supports it;
- preserve revisions only as final canonical state by default, with optional diagnostic history;
- ensure restored sessions display identically to live final state.

## P2.6 Engine health and automatic recovery

Tasks:

- explicit state machine: stopped / starting / running / degraded / recovering / failed;
- device reconnection policy;
- model/runtime crash detection;
- bounded automatic restart;
- never spin endlessly after deterministic configuration failure;
- visible reason for degraded state.

## P2.7 Packaging and model lifecycle

Tasks:

- checksummed downloads;
- atomic model install/upgrade;
- versioned model manifests;
- disk usage display;
- remove old models safely;
- offline startup using cached assets;
- consistent paths per OS;
- verify bundled native runtime libraries on clean machines.

## P2.8 TTS/runtime consolidation investigation

Moonshine Voice now includes additional voice/TTS capabilities. Evaluate later whether this can replace part of the current Sherpa/Kokoro path.

This is deliberately below STT accuracy work. Do not destabilize the speech-input architecture merely to reduce dependency count.

Acceptance for any migration:

- voice quality/latency at least matches current supported use cases;
- cross-platform packaging is simpler or demonstrably more reliable;
- no regression to STT runtime isolation.

---

## 5. Cross-Platform Implementation Strategy

Shared behavior must live above platform capture code.

```text
speech/audio/platform/windows.rs  -> WASAPI / loopback / endpoint notifications
speech/audio/platform/macos.rs    -> CoreAudio + ScreenCaptureKit system audio
speech/audio/platform/linux.rs    -> PipeWire/Pulse capture + monitor/node handling
```

The following must remain platform-neutral:

- transcript schema;
- engine trait;
- model management interface;
- context biasing;
- diarization preference semantics;
- persistence;
- prompt roles;
- benchmark result schema;
- diagnostics event schema.

A platform backend should expose capabilities, not conditional behavior scattered through the engine.

---

## 6. Proposed Engine Contract

Illustrative Rust interface:

```rust
pub trait SpeechEngine: Send {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> SpeechEngineCapabilities;
    fn start_track(&mut self, config: TrackEngineConfig) -> Result<TrackHandle, SpeechError>;
    fn push_audio(&mut self, track: TrackHandle, chunk: AudioChunk) -> Result<(), SpeechError>;
    fn update_context(&mut self, track: TrackHandle, context: BiasContext) -> Result<(), SpeechError>;
    fn flush(&mut self, track: TrackHandle) -> Result<(), SpeechError>;
    fn stop_track(&mut self, track: TrackHandle) -> Result<(), SpeechError>;
}
```

Capabilities should explicitly report support for:

- streaming partials;
- stable line revisions;
- word timestamps;
- word confidence;
- speaker diarization/spans;
- runtime keyterms/context;
- GPU acceleration;
- supported languages;
- required sample formats/rates.

Higher layers must branch on capabilities rather than engine names whenever possible.

---

## 7. Context Bias Manager Rules

The bias manager should maintain a bounded, inspectable active context.

Candidate scoring inputs:

- user glossary: highest weight;
- explicit session context: high;
- current window/app title: high;
- repeated OCR token: medium-high;
- capitalized/mixed-case identifier: medium-high;
- code-style token containing `_`, `::`, `.`, `/`, or internal capitals: medium-high;
- stale one-off OCR: low;
- common dictionary words: very low.

Recommended behavior:

- dedupe case-insensitively while preserving canonical spelling;
- cap terms and context length;
- decay stale OCR terms over time;
- retain sticky glossary/session terms;
- push only changed context to the engine;
- log active term set in diagnostics;
- benchmark several caps instead of assuming “more terms = better”.

---

## 8. Speaker Identity Model

Use three concepts, not one overloaded speaker number:

1. **Role** — `you`, `them`, `unknown` derived from capture topology.
2. **Engine speaker key** — stream-scoped machine identity, e.g. `system:2`.
3. **Display name** — session label such as `Sarah`.

Examples:

```text
mic track    -> role=you,  speakerKey optional, display=You
system span  -> role=them, speakerKey=system:1, display=Speaker 1
renamed      -> role=them, speakerKey=system:1, display=Sarah
```

Never infer global biometric identity across sessions without an explicit future feature, consent model, and accuracy/privacy design.

---

## 9. Reliability and Backpressure

Audio loss must be observable.

Each track should expose:

- native samples captured;
- conditioned samples produced;
- samples queued;
- samples consumed;
- samples dropped;
- queue high-water mark;
- last callback time;
- last inference time;
- current real-time factor;
- current model;
- capture backend;
- device identity;
- mute state;
- speaking state.

Policy:

- use bounded queues;
- never let a slow engine grow memory without limit;
- prefer controlled model downgrade / batching policy over silent audio loss;
- surface unrecoverable overload in status.

---

## 10. Storage and Migration

Move from feed snapshots as the source of truth to canonical transcript storage.

Recommended stores:

```text
sessions
responses
transcriptLines
speakerNames
preferences
speechBenchmarks (optional local diagnostics)
```

Migration requirements:

- existing `feedItems` sessions remain readable;
- convert legacy audio feed items into minimal canonical lines when loaded;
- old data without speaker labels remains valid;
- avoid destructive migration until conversion path is proven;
- version transcript schema explicitly.

---

## 11. Testing Strategy

### Unit

- transcript reducer/revision behavior;
- role/speaker formatting;
- preference defaults;
- context candidate ranking/deduping;
- resampling/channel conversion;
- clock conversions;
- schema migration;
- engine capability negotiation.

### Native integration

- mock audio track → engine → canonical transcript event;
- start/stop/flush/restart;
- context update while running;
- diarization toggle while running;
- device loss status transition;
- bounded queue overflow behavior.

### Frontend

- revised line updates in-place;
- renamed speaker propagation;
- saved/reloaded transcript fidelity;
- diarization preference UX;
- degraded platform capability states.

### Benchmark

- fixed corpus comparative measurements;
- output artifact with config/model/commit metadata;
- thresholds for catastrophic regression.

### Runtime/platform

Do not call macOS/Linux/Windows capture parity closed without real runtime evidence from that OS. Compilation and unit tests are necessary but not equivalent to capture proof.

---

## 12. Work-Batch Order

Execute large coherent batches in this order unless a newly discovered safety/dependency issue changes priority.

### Batch A — P0 transcript correctness

- preserve speaker identity end-to-end;
- authoritative device roles;
- speaker-aware prompts;
- persist speaker labels;
- diarization default-on preference;
- live native toggle;
- regression tests.

### Batch B — P0 canonical transcript

- Rust schema;
- revision reducer;
- TS schema;
- persistence migration;
- feed projection;
- LLM projection;
- tests for update/finalize/speaker-revision behavior.

### Batch C — P0 audio-core extraction

- common track abstraction;
- proper resampler;
- arbitrary channel conversion;
- sample clock;
- bounded queues/backpressure metrics;
- move Whisper/Deepgram consumers onto it.

### Batch D — P0 benchmark + diagnostics

- benchmark command/schema;
- initial fixtures;
- metrics;
- optional conditioned-audio dump;
- structured diagnostics bundle.

### Batch E — P0 platform capability layer

- move Windows capture into platform module;
- implement truthful macOS/Linux capability scaffolding;
- implement native system capture paths;
- device loss/reconnect behavior;
- platform matrix.

### Batch F — P1 Moonshine Voice streaming

- validate wrapper/ABI choice first;
- streaming engine implementation;
- model lifecycle;
- revisions/words/confidence;
- diarization spans;
- runtime context/keyterms;
- shipping-path integration.

### Batch G — P1 context intelligence

- Context Bias Manager;
- OCR/identifier extraction;
- user glossary;
- live context updates;
- benchmark entity accuracy.

### Batch H — P1 echo/turn intelligence

- AEC evaluation/integration;
- cross-track duplicate measurement;
- turn completion signals;
- smart-trigger improvements.

### Batch I — P2 verifier/adaptation/polish

- confidence-triggered verification;
- LoRA/domain-adaptation evaluation;
- diagnostics UI/export;
- model maintenance;
- optional TTS consolidation.

---

## 13. Completion Gates by Priority

### P0 complete only when

- canonical transcript line model is shipping;
- speaker metadata survives all layers;
- diarization is default-on and truly disableable;
- no legitimate phrase blacklist remains;
- audio capture/conditioning is separated from engines;
- production resampling/channel handling is in place;
- buffer loss is measurable;
- benchmark harness exists and can compare configurations;
- capture capability state is explicit on all three desktop OS targets;
- runtime parity claims are evidence-based.

### P1 complete only when

- current Moonshine Voice streaming is the first-class local path or a documented validated alternative was required;
- word metadata/revisions/speaker spans are consumed end-to-end;
- screen/session context updates local ASR live;
- speaker rename works through persistence and prompts;
- model quality auto-selection is measurable;
- echo/duplicate handling is benchmarked;
- Windows/macOS/Linux runtime matrix has evidence for implemented features.

### P2 complete only when

- low-confidence verification is selective and measured;
- any adaptation demonstrates held-out improvement;
- transcript inspection/export is faithful;
- model lifecycle and recovery are production-grade;
- optional runtime consolidation does not regress speech-input reliability.

---

## 14. Metrics Targets

Exact thresholds should be calibrated from the initial benchmark, but greenfield work should optimize toward:

- zero unexplained sample loss in normal sustained operation;
- zero duplicate final transcript lines from revisions;
- zero intentional loss of speaker metadata between layers;
- near-zero mic/system duplicate lines with AEC/headphones in normal use;
- lower technical-entity error rate with context bias enabled;
- no measurable first-word clipping regression;
- end-of-turn latency low enough for conversational assistance;
- real-time factor comfortably below 1.0 on the auto-selected model;
- deterministic degradation when hardware cannot sustain the requested quality.

Do not hard-code a target WER before the PRMPTR corpus establishes realistic baselines by condition.

---

## 15. Current Known Technical Debt to Eliminate

- Moonshine implemented as a `use_moonshine` boolean inside Whisper-oriented manager/config naming;
- older sherpa Moonshine Base batch inference instead of modern Moonshine Voice streaming;
- custom VAD/utterance segmentation owning behavior a streaming engine can provide natively;
- linear resampling;
- stereo-pair assumptions;
- system capture intentionally skipped on non-Windows;
- speaker embeddings applied at whole-segment granularity rather than span-level diarization;
- legacy feed model too small for revisions/word confidence/timestamps;
- transcript buffer source/provenance oriented around `local-whisper` even when another engine is active;
- processing-time timestamps in places where audio-clock timing is needed;
- duplicate audio capture/conditioning logic across local/cloud engines;
- common-word artifact blacklists;
- insufficient benchmark coverage for actual speech quality;
- no first-class AEC/cross-track leakage strategy;
- no runtime contextual biasing from PRMPTR's screen awareness.

---

## 16. Upstream References to Track

- Moonshine Voice: https://github.com/moonshine-ai/moonshine
- Moonshine releases/changelog and C API changes
- `moonshine-rs` wrapper compatibility and Tauri example status
- WebRTC Audio Processing / equivalent AEC options
- Rubato or equivalent resampling library
- platform audio API changes: WASAPI, ScreenCaptureKit/CoreAudio, PipeWire

Pin exact dependency versions in shipping code. Re-evaluate upstream features through benchmark/runtime evidence before adopting them.

---

## 17. Final Product Experience

The intended result should feel simple even though the engine is sophisticated:

```text
Transcription quality: Auto
Speaker separation: On
Improve names & technical terms from screen: On
Noise/echo processing: Auto

YOU
Yeah, the state is updated through the reducer.

SARAH
Does that mean the transcript can revise an earlier speaker assignment?

JAMES
And does Moonshine give you word confidence too?
```

Behind that UI, PRMPTR should know:

- which physical/virtual track produced each word;
- which participant spoke each span;
- the audio-clock timing;
- whether the line changed later;
- recognition confidence where available;
- which model/version produced it;
- what contextual terms were active;
- how long inference took;
- whether any audio was dropped;
- whether the platform is operating at full capability.

That is the greenfield standard for calling the speech system “dialed in.”
