"use client";

/* Hallmark · audit+update · genre: atmospheric · nav: N1b · footer: Ft4 (columns + legal line)
 * theme: custom (tokens in landing.css) · enrichment: real app screenshots (public/screenshots)
 * pre-emit critique: P4 H4 E4 S5 R4 V4
 * Copy rule: every number on this page was measured on a real build (see README/Testing).
 */

import {
  AppWindow,
  Brain,
  CheckCircle,
  Cpu,
  DesktopTower,
  DownloadSimple,
  GithubLogo,
  Image as ImageIcon,
  LockKey,
  Microphone,
  ShieldCheck,
  ToggleRight,
  Waveform,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, type CSSProperties, type PropsWithChildren } from "react";

/** Custom PRMPTR ear logo (inline SVG). */
function Logo({ className = "", size = 22, bold = false }: { className?: string; size?: number; bold?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <path fill="currentColor" {...(bold ? { stroke: "currentColor", strokeWidth: "0.5", strokeLinejoin: "round" } : {})} d="m5 13q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7c0-2.4 0.9-4.7 2.6-6.4 1.7-1.7 4-2.6 6.4-2.6 2.4 0 4.7 0.9 6.4 2.6 1.7 1.7 2.6 4 2.6 6.4 0 3.3-1.1 4.4-2.2 5.5-1.1 1-2.3 2.2-2.3 5q0 0.9-0.3 1.7-0.4 0.8-1 1.5-0.7 0.6-1.5 1-0.8 0.3-1.7 0.3c-1.3 0-2.3-0.5-3.2-1.6q-0.3-0.4-0.7-0.4-0.4 0-0.7 0.2-0.4 0.3-0.4 0.7 0 0.4 0.2 0.7 2 2.4 4.8 2.4 1.3 0 2.5-0.5 1.2-0.5 2.1-1.4 0.9-0.9 1.4-2.1 0.5-1.2 0.5-2.5c0-2 0.7-2.7 1.7-3.6 1.2-1.2 2.8-2.7 2.8-6.9 0-2.9-1.2-5.7-3.2-7.8-2.1-2-4.9-3.2-7.8-3.2-2.9 0-5.7 1.2-7.8 3.2-2 2.1-3.2 4.9-3.2 7.8zm4.8 7.1q0.1-0.1 0.3-0.1 0.2 0 0.4 0 0.2 0.1 0.4 0.2 0.1 0.1 0.2 0.3 0.2 0.3 0.5 0.4 0.3 0.2 0.7 0.1 0.3-0.1 0.5-0.4 0.2-0.3 0.2-0.6c0-1.2-0.6-2-1.3-2.9-0.8-1.1-1.7-2.3-1.7-4.1 0-1.6 0.6-3.1 1.8-4.2 1.1-1.2 2.6-1.8 4.2-1.8 1.6 0 3.1 0.6 4.2 1.8 1.2 1.1 1.8 2.6 1.8 4.2q0 0.4-0.3 0.7-0.3 0.3-0.7 0.3-0.4 0-0.7-0.3-0.3-0.3-0.3-0.7c0-1.1-0.4-2.1-1.2-2.8-0.7-0.8-1.7-1.2-2.8-1.2-1.1 0-2.1 0.4-2.8 1.2-0.8 0.7-1.2 1.7-1.2 2.8 0 1.2 0.6 2 1.3 2.9 0.8 1.1 1.7 2.3 1.7 4.1 0 0.7-0.2 1.3-0.6 1.8-0.4 0.5-1 0.9-1.6 1.1-0.7 0.2-1.3 0.1-1.9-0.1-0.7-0.3-1.2-0.7-1.5-1.3q-0.1-0.2-0.1-0.4 0-0.2 0-0.4 0.1-0.1 0.2-0.3 0.1-0.2 0.3-0.3zm10-11.7c1.2 1 2 2.4 2.2 4 0.1 1.6-0.3 3.2-1.3 4.4-1 1.2-2.5 2-4.1 2.2-1.5 0.2-3.1-0.3-4.4-1.3q-0.3-0.3-0.3-0.7-0.1-0.4 0.2-0.7 0.2-0.3 0.7-0.4c0.2 0 0.5 0 0.7 0.2 0.4 0.5 1.9 1 2.9 0.9 1.1-0.1 2-0.6 2.7-1.4 0.7-0.9 1-1.9 0.9-3-0.1-1-0.7-2-1.5-2.7-0.9-0.7-1.3-0.9-2.4-0.9" />
    </svg>
  );
}

const DOWNLOAD_URL = "https://github.com/thomaslittle/prmptr/releases/tag/v0.1.0";
const REPO_URL = "https://github.com/thomaslittle/prmptr";

const localChain = [
  { icon: Microphone, title: "Capture", meta: "mic + system audio" },
  { icon: Waveform, title: "Silero VAD v6.2", meta: "drops silence" },
  { icon: Cpu, title: "Parakeet", meta: "on device" },
];

const routes = [
  { icon: AppWindow, title: "Your AI apps", detail: "Claude Code · Codex · OpenCode · Gemini CLI · Ollama", tag: "via OriginLM" },
  { icon: Brain, title: "API keys", detail: "Claude 5.5 · GPT-6.x · Groq · Cerebras · OpenCode Zen", tag: "your key" },
  { icon: DesktopTower, title: "Fully local", detail: "LM Studio or Ollama on this machine", tag: "offline" },
];

const features = [
  { icon: Microphone, title: "Hears both sides", body: "Your mic and the system audio on separate channels — You and Them — each mutable live from the header." },
  { icon: Waveform, title: "Silence stays silent", body: "Silero VAD v6.2 gates the speech model, so room noise never turns into a phantom “Thank you.”" },
  { icon: Cpu, title: "Parakeet on your CPU", body: "Punctuated English by default. Parakeet v3 covers 25 European languages; Whisper Large v3 Turbo, 99." },
  { icon: ShieldCheck, title: "Verified downloads", body: "Every speech model is pinned to an exact revision and SHA-256 checked before it’s used." },
  { icon: AppWindow, title: "Your AI apps", body: "Use the Claude Code, Codex or Gemini CLI subscription you already have. Your logins never leave those apps." },
  { icon: ImageIcon, title: "Screen context", body: "Optionally attach a screenshot when you hit Analyze, for models that can see." },
];

const approach = [
  {
    title: "A speech model built for live talk.",
    body: "Parakeet Unified transcribes eight seconds of speech in under half a second on an ordinary desktop CPU. No GPU, no cloud — and optional Vulkan or CUDA builds if you have a card.",
  },
  {
    title: "A gate that knows when to stay quiet.",
    body: "Silence never reaches the model, and in smart mode new dialogue is checked before a suggestion fires — so it speaks up on substance, not on every pause.",
  },
  {
    title: "Swap the reasoning layer whenever you like.",
    body: "Run a turn through an AI app you’re already signed into, use an API key, or stay air-gapped with LM Studio. Change it per session.",
  },
];

const measured = [
  { label: "8.2 s of speech → text", value: "0.49 s", note: "Parakeet Unified, CPU only" },
  { label: "Speech model load", value: "0.2–0.4 s", note: "when you press Start" },
  { label: "Installer", value: "36 MB", note: "Windows x64, NSIS" },
  { label: "Speech model download", value: "731 MB", note: "once, SHA-256 verified" },
];

const capabilities = [
  { title: "Keeps the first word.", body: "Each utterance gets 600 ms of audio from before the VAD triggered, so soft openings aren’t clipped." },
  { title: "Presets for the situation.", body: "Interview, roleplay, meeting, podcast, lecture or general — each loads its own context, editable inline." },
  { title: "Ten personalities, tuned not tweaked.", body: "Roast Master through Grandpa to Unhinged. Each is a full prompt with its own register, not a temperature slider." },
  { title: "Speaks the answer if you want.", body: "A local Kokoro voice (downloaded on first use) or your own TTS endpoint, with voice, rate and volume adjustable." },
  { title: "Manual, auto or smart triggers.", body: "Fire on a global shortcut, on a timer you set, or let the gate decide. Interval and context size are sliders." },
  { title: "History that stays put.", body: "Every session and response is saved on this machine and searchable later. Nothing is synced anywhere." },
];

const stats = [
  { key: "Speech to text", value: "~17×", note: "faster than real time, CPU" },
  { key: "Offline", value: "Full", note: "transcription needs no network" },
  { key: "Speech models", value: "5", note: "English up to 99 languages" },
  { key: "Base cost", value: "$0", note: "MIT, no account, no meter" },
];

const faqs = [
  {
    question: "What is PRMPTR?",
    answer: "A desktop app that listens to your microphone and system audio, transcribes both on your machine, and suggests what to say next — answers, comebacks, facts — in the personality you pick.",
  },
  {
    question: "Does it need the cloud?",
    answer: "No. Transcription runs on-device with Parakeet. Deepgram is the one optional cloud transcription mode. For suggestions you can stay fully local with LM Studio or Ollama.",
  },
  {
    question: "Can I use my Claude or ChatGPT subscription?",
    answer: "Yes — through Your AI apps. PRMPTR finds the AI apps you’re signed into (Claude Code, Codex, OpenCode, Gemini CLI, Ollama, LM Studio) via OriginLM and runs each request through that app. Your logins never leave it, so this stays within each provider’s terms.",
  },
  {
    question: "What hardware does it need?",
    answer: "A Windows 10 or 11 x64 PC. Any modern CPU transcribes faster than real time; the default speech model is a one-time 731 MB download. GPU builds are optional.",
  },
  {
    question: "Where do my API keys live?",
    answer: "In an app-private store file on your machine — never in browser storage — and only the provider APIs you use can be reached from the app.",
  },
  {
    question: "What does it cost?",
    answer: "The app is free and MIT licensed, with no account and no usage meter. If you use an API key you pay that provider directly; Your AI apps uses the plans you already have.",
  },
];

type LandingProps = {
  motion?: boolean;
  mainScreenshot?: string;
  captureScreenshot?: string;
  voiceScreenshot?: string;
};

function Reveal({ children, className = "", enabled = true }: PropsWithChildren<{ className?: string; enabled?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.visible = "true";
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.visible = "true";
        observer.disconnect();
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <div ref={ref} className={`prmptr-reveal ${className}`} data-visible={enabled ? undefined : "true"}>
      {children}
    </div>
  );
}

function SectionShell({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <div className={`groove-x mx-auto box-border max-w-[1360px] border-x border-[var(--color-rule)] px-5 py-16 sm:px-8 lg:px-9 lg:py-[88px] ${className}`}>{children}</div>;
}

function CutCard({ children, innerClassName = "" }: PropsWithChildren<{ innerClassName?: string }>) {
  return (
    <div className="h-full">
      <div className={`prmptr-cut-card-inner groove h-full border border-[var(--color-rule)] bg-[var(--color-paper-3)] ${innerClassName}`}>{children}</div>
    </div>
  );
}

function DuplexHelix({ active = true, points = 44 }: { active?: boolean; points?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: points }, (_, i) => ({
        phase: `${(-i * 0.055).toFixed(3)}s`,
        amplitude: Math.round(18 + Math.abs(Math.sin(i * 0.38)) * 14 + Math.abs(Math.cos(i * 0.17)) * 8),
      })),
    [points],
  );

  return (
    <span className="relative h-24 min-w-0 flex-1" aria-hidden="true">
      <span className="absolute inset-x-3 inset-y-0 flex items-center">
        {dots.map((dot, i) => (
          <span key={i} className="relative h-full flex-1" style={{ "--phase": dot.phase, "--amplitude": `${dot.amplitude}px` } as CSSProperties}>
            <i className={`duplex-helix-a absolute left-1/2 top-1/2 h-2 w-2 rounded-full ${active ? "is-active" : ""}`} />
            <i className={`duplex-helix-b absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full ${active ? "is-active" : ""}`} />
          </span>
        ))}
      </span>
    </span>
  );
}

function CutButton({ href, children, primary = true }: PropsWithChildren<{ href: string; primary?: boolean }>) {
  return (
    <span className={`prmptr-cut-button-wrap p-px ${primary ? "bg-[var(--color-on-signal)]" : "bg-[var(--color-on-signal-soft)]"}`}>
      <a
        href={href}
        className={`prmptr-cut-button inline-flex h-[54px] items-center gap-2.5 whitespace-nowrap px-7 font-mono text-[13px] font-bold ${
          primary
            ? "bg-[var(--color-on-signal)] text-[var(--color-ink)] hover:bg-[var(--color-signal)] hover:text-[var(--color-on-signal)]"
            : "bg-[var(--color-signal)] text-[var(--color-on-signal)] hover:bg-[var(--color-on-signal)] hover:text-[var(--color-ink)]"
        }`}
      >
        {children}
      </a>
    </span>
  );
}

export default function PrmptrLanding({
  motion = true,
  mainScreenshot = "/screenshots/main.png",
  captureScreenshot = "/screenshots/capture.png",
  voiceScreenshot = "/screenshots/voice.png",
}: LandingProps) {
  return (
    <main className="prmptr-page relative min-h-screen selection:bg-[var(--color-accent-line)]">
      {/* ── Hero ── */}
      <section id="top" className="prmptr-signal-band relative overflow-hidden">
        <Logo className="pointer-events-none absolute -right-[110px] -top-[70px] hidden h-[1000px] w-[1000px] text-[var(--color-ink)] opacity-15 lg:block" />

        <nav className="relative mx-auto flex max-w-[1360px] items-center justify-between px-5 pt-6 sm:px-8 lg:px-9" aria-label="Main">
          <a href="#top" className="flex items-center gap-2.5">
            <Logo size={22} bold />
            <span className="font-mono text-[21px] font-semibold tracking-[0.06em]">PRMPTR</span>
          </a>
          <div className="flex items-center gap-4 font-mono text-xs sm:gap-6">
            <a href="#how" className="hidden whitespace-nowrap md:inline">How it works</a>
            <a href="#app" className="hidden whitespace-nowrap md:inline">The app</a>
            <a href="#faq" className="hidden whitespace-nowrap md:inline">FAQ</a>
            <a href={REPO_URL} className="hidden whitespace-nowrap sm:inline">Source</a>
            <span className="prmptr-nav-button-wrap bg-[var(--color-on-signal)] p-px">
              <a href={DOWNLOAD_URL} className="prmptr-nav-button inline-flex h-[38px] items-center whitespace-nowrap bg-[var(--color-on-signal)] px-4 font-bold text-[var(--color-ink)] hover:bg-[var(--color-signal)] hover:text-[var(--color-on-signal)] sm:px-5">
                <span className="sm:hidden">Download</span>
                <span className="hidden sm:inline">Download v0.1.0</span>
              </a>
            </span>
          </div>
        </nav>

        <div className="relative mx-auto max-w-[1360px] px-5 pb-20 pt-20 sm:px-8 lg:px-9 lg:pb-[92px] lg:pt-[100px]">
          <h1 className={`${motion ? "prmptr-rise" : ""} max-w-[17ch] text-[clamp(2.75rem,6.4vw,6rem)] font-medium leading-[0.92] tracking-[-0.03em]`}>
            Your <span className="cc-glow">c</span>onversation <span className="cc-glow">c</span>opilot.
          </h1>
          <p className={`${motion ? "prmptr-rise prmptr-rise-delay-1" : ""} mt-8 max-w-[50ch] text-[17px] leading-[1.55] sm:text-[19px]`}>
            PRMPTR listens to your mic and system audio, transcribes both on your own machine, and puts the right line on screen before the pause ends. Answer with an API key, with the AI apps you already pay for, or fully offline.
          </p>
          <div className={`${motion ? "prmptr-rise prmptr-rise-delay-2" : ""} mt-10 flex flex-wrap gap-4`}>
            <CutButton href={DOWNLOAD_URL}>
              <DownloadSimple size={17} weight="bold" />
              Download for Windows
            </CutButton>
            <CutButton href="#app" primary={false}>
              See it running
            </CutButton>
          </div>
        </div>
      </section>

      {/* ── Listening strip ── */}
      <section className="groove-b border-b border-[var(--color-rule)] bg-[var(--color-paper-sunk)]" aria-label="Status">
        <div className="mx-auto flex max-w-[1360px] items-center gap-4 px-5 py-5 sm:px-8 lg:gap-[30px] lg:px-9 lg:py-[26px]">
          <span className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent-text)]">
            <span className={`${motion ? "prmptr-pulse" : ""} h-[7px] w-[7px] rounded-full bg-[var(--color-ok)]`} />
            Listening
          </span>
          <DuplexHelix active={motion} />
          <span className="hidden shrink-0 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)] lg:inline">
            Parakeet · Silero VAD v6.2 · on device
          </span>
        </div>
      </section>

      {/* ── How it works: local chain + three routes ── */}
      <section id="how" className="groove-b border-b border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        <SectionShell>
          <h2 className="max-w-[20ch] text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">
            Hearing happens here. Answers come from wherever you like.
          </h2>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-[1.6] text-[var(--color-ink-2)]">
            Capture, voice detection and transcription always run on your machine. The suggestion step is yours to route.
          </p>

          <div className="groove mt-12 grid overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-3)] lg:grid-cols-[minmax(0,1fr)_172px_minmax(0,1.15fr)]">
            <div className="p-6 sm:p-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">Always on your machine</p>
              <div className="mt-5 flex flex-col gap-2.5">
                {localChain.map(({ icon: Icon, title, meta }) => (
                  <div key={title} className="prmptr-small-cut bg-[var(--color-accent-line)] p-px">
                    <div className="prmptr-small-cut-inner flex items-center gap-3.5 bg-[var(--color-paper)] p-3.5 sm:px-4">
                      <Icon size={19} className="shrink-0 text-[var(--color-accent-text)]" />
                      <span className="flex-1 font-mono text-[12.5px] uppercase tracking-[0.1em]">{title}</span>
                      <span className="font-mono text-[11px] text-[var(--color-ink-3)]">{meta}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[var(--color-ok)]">
                <CheckCircle size={14} weight="bold" /> No account or key to transcribe
              </p>
            </div>

            <div className="groove-x flex items-center justify-center gap-4 border-y border-[var(--color-rule)] bg-[var(--color-paper-4)] p-5 lg:flex-col lg:border-x lg:border-y-0 lg:px-0 lg:py-8">
              <span className="h-px flex-1 bg-[var(--color-rule-strong)] lg:h-auto lg:w-px" />
              <span className="flex flex-col items-center gap-2 border border-[var(--color-accent-line)] bg-[var(--color-accent-tint)] px-4 py-3.5 text-center">
                <ToggleRight size={22} weight="bold" className="text-[var(--color-accent-text)]" />
                <span className="font-mono text-[9.5px] uppercase leading-[1.5] tracking-[0.16em] text-[var(--color-accent-text)]">Your<br />call</span>
              </span>
              <span className="h-px flex-1 bg-[var(--color-rule-strong)] lg:h-auto lg:w-px" />
            </div>

            <div className="p-6 sm:p-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">Where the answer comes from</p>
              <div className="mt-5 flex flex-col gap-2.5">
                {routes.map(({ icon: Icon, title, detail, tag }) => (
                  <div key={title} className="groove flex items-start gap-3.5 border border-[var(--color-rule)] p-3.5 sm:px-4">
                    <Icon size={19} className="mt-0.5 shrink-0 text-[var(--color-ink-2)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[12.5px] uppercase tracking-[0.1em]">{title}</span>
                      <span className="mt-1 block text-[13px] leading-[1.5] text-[var(--color-ink-2)]">{detail}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">{tag}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">Logins never leave your AI apps</p>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* ── The app ── */}
      <section id="app" className="groove-b border-b border-[var(--color-rule)]">
        <SectionShell>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
            <h2 className="max-w-[16ch] text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">The room, the answer, the knobs.</h2>
            <p className="max-w-[52ch] text-[17px] leading-[1.6] text-[var(--color-ink-2)]">
              Transcript on the left, suggestions in the middle, everything tunable on the right — preset, model, trigger, personality, response style.
            </p>
          </div>

          <figure className="mt-12 border border-[var(--color-rule-strong)] bg-[var(--color-paper-deep)]">
            <img src={mainScreenshot} alt="PRMPTR main window: the live transcript, a streamed suggestion, and the session settings" className="block h-auto w-full" />
          </figure>

          <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-[22px]">
            <Reveal enabled={motion}>
              <CutCard innerClassName="overflow-hidden bg-[var(--color-paper-deep)] p-0">
                <img src={captureScreenshot} alt="Settings: audio devices, local or Deepgram transcription, and the speech model list" className="block h-auto w-full" />
                <div className="groove-t border-t border-[var(--color-rule)] px-5 pb-5 pt-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-accent-text)]">Capture</p>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[var(--color-ink-2)]">
                    Pick your devices and a speech model. Parakeet is the default; Deepgram is the one cloud option if you want it.
                  </p>
                </div>
              </CutCard>
            </Reveal>
            <Reveal enabled={motion}>
              <CutCard innerClassName="overflow-hidden bg-[var(--color-paper-deep)] p-0">
                <img src={voiceScreenshot} alt="Settings: text-to-speech voice reply options" className="block h-auto w-full" />
                <div className="groove-t border-t border-[var(--color-rule)] px-5 pb-5 pt-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-accent-text)]">Voice reply</p>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[var(--color-ink-2)]">
                    Hear each suggestion through a local Kokoro voice or your own TTS endpoint, with voice, rate and volume under your control.
                  </p>
                </div>
              </CutCard>
            </Reveal>
          </div>

          <div className="groove mt-5 grid overflow-hidden border border-[var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-2.5 border-b border-r border-[var(--color-rule)] bg-[var(--color-paper-3)] p-5 sm:p-6">
                <Icon size={20} className="text-[var(--color-accent-text)]" />
                <h3 className="text-[17px] font-medium tracking-[-0.02em]">{title}</h3>
                <p className="text-[13.5px] leading-[1.6] text-[var(--color-ink-2)]">{body}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      </section>

      {/* ── Approach + measured numbers ── */}
      <section className="groove-b border-b border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        <SectionShell>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
            <div>
              <h2 className="max-w-[14ch] text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">Small models, close to the mic.</h2>
              <div className="groove-t mt-10 border-t border-[var(--color-rule)]">
                {approach.map((step) => (
                  <Reveal key={step.title} enabled={motion} className="groove-b border-b border-l-2 border-b-[var(--color-rule)] border-l-[var(--color-accent-line)] py-6 pl-6 sm:py-7">
                    <h3 className="max-w-[32ch] text-[24px] font-medium leading-[1.1] tracking-[-0.025em]">{step.title}</h3>
                    <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.7] text-[var(--color-ink-2)] [text-wrap:pretty]">{step.body}</p>
                  </Reveal>
                ))}
              </div>
            </div>

            <CutCard innerClassName="p-6 sm:p-8 lg:self-start">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">Measured on a real build</p>
              <p className="mt-2 text-[13px] leading-[1.6] text-[var(--color-ink-3)]">Ryzen 7 7800X3D, CPU only, release build.</p>
              <dl className="mt-6 flex flex-col">
                {measured.map((m) => (
                  <div key={m.label} className="groove-b grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-[var(--color-rule)] py-4 first:pt-0">
                    <dt className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--color-ink-2)]">{m.label}</dt>
                    <dd className="text-right text-[30px] font-medium leading-none tracking-[-0.03em] tabular-nums">{m.value}</dd>
                    <dd className="col-span-2 mt-1.5 font-mono text-[11px] text-[var(--color-ink-3)]">{m.note}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
                <Cpu size={14} /> GPU: optional Vulkan or CUDA builds
              </p>
            </CutCard>
          </div>
        </SectionShell>
      </section>

      {/* ── Capabilities + stats ── */}
      <section id="capabilities" className="groove-b border-b border-[var(--color-rule)]">
        <SectionShell className="pb-0">
          <h2 className="max-w-[18ch] text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">Built for the moment you need a line.</h2>
          <div className="mt-12 grid md:grid-cols-2 lg:mt-14 lg:grid-cols-3">
            {capabilities.map((capability) => (
              <Reveal key={capability.title} enabled={motion}>
                <div className="groove h-full border border-[var(--color-rule)] p-7 sm:px-[30px] sm:pb-8">
                  <h3 className="text-[21px] font-medium leading-[1.1] tracking-[-0.025em]">{capability.title}</h3>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-[var(--color-ink-2)] [text-wrap:pretty]">{capability.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </SectionShell>

        <dl className="groove mx-auto mt-14 grid max-w-[1360px] border-y border-[var(--color-rule)] sm:grid-cols-2 lg:mt-[68px] lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.key} className="border-b border-r border-[var(--color-rule)] px-5 py-7 first:border-l sm:px-8 lg:px-9 lg:py-[30px]">
              <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent-text)]">{stat.key}</dt>
              <dd className="mt-4 text-[42px] font-medium leading-none tracking-[-0.035em] tabular-nums lg:text-[46px]">{stat.value}</dd>
              <dd className="mt-3 font-mono text-[11.5px] text-[var(--color-ink-3)]">{stat.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="groove-b border-b border-[var(--color-rule)] bg-[var(--color-paper-2)]">
        <SectionShell className="grid gap-12 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)] lg:gap-[72px]">
          <div>
            <h2 className="text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">Questions, answered.</h2>
            <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.7] text-[var(--color-ink-2)]">
              Everything else lives in the README. Issues and pull requests are open.
            </p>
          </div>
          <div className="groove-t border-t border-[var(--color-rule)]">
            {faqs.map((faq) => (
              <div key={faq.question} className="groove-b border-b border-[var(--color-rule)] py-6">
                <h3 className="text-xl font-medium tracking-[-0.02em]">{faq.question}</h3>
                <p className="mt-3 max-w-[70ch] text-[14.5px] leading-[1.75] text-[var(--color-ink-2)] [text-wrap:pretty]">{faq.answer}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      </section>

      {/* ── Closing CTA ── */}
      <section className="prmptr-signal-band relative overflow-hidden">
        <Logo className="pointer-events-none absolute -bottom-[190px] -left-[160px] hidden h-[620px] w-[620px] text-[var(--color-on-signal-faint)] lg:block" />
        <div className="relative mx-auto flex max-w-[1360px] flex-col items-center px-5 py-20 text-center sm:px-8 lg:px-9 lg:pb-24 lg:pt-[88px]">
          <Logo size={132} />
          <h2 className="mx-auto mt-[30px] max-w-[20ch] text-[clamp(2.5rem,5.2vw,4.75rem)] font-medium leading-[0.92] tracking-[-0.03em]">Your copilot, ready when you are.</h2>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <CutButton href={DOWNLOAD_URL}>
              <DownloadSimple size={17} weight="bold" />
              Download v0.1.0
            </CutButton>
            <CutButton href={REPO_URL} primary={false}>
              <GithubLogo size={17} weight="bold" />
              Read the source
            </CutButton>
          </div>
          <p className="mt-5 font-mono text-xs uppercase tracking-[0.16em] opacity-75">No account · 36 MB installer · bring a key, your AI apps, or neither</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[var(--color-paper-footer)]">
        <div className="mx-auto grid max-w-[1360px] gap-9 px-5 pb-6 pt-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] lg:px-9 lg:pt-14">
          <div>
            <span className="flex items-center gap-2.5">
              <Logo size={20} bold className="text-[var(--color-accent-text)]" />
              <span className="font-mono text-lg font-semibold tracking-[0.06em]">PRMPTR</span>
            </span>
            <p className="mt-4 max-w-[32ch] text-sm leading-[1.7] text-[var(--color-ink-2)]">Your conversation copilot. On-device speech, open source, MIT licensed.</p>
          </div>
          <FooterColumn title="Project" links={[["GitHub", REPO_URL], ["Releases", `${REPO_URL}/releases`], ["Issues", `${REPO_URL}/issues`]]} />
          <FooterColumn title="Docs" links={[["README", `${REPO_URL}#readme`], ["Contributing", `${REPO_URL}/blob/main/CONTRIBUTING.md`], ["Security", `${REPO_URL}/security/policy`]]} />
          <div className="flex flex-col gap-2.5 font-mono text-[12.5px] text-[var(--color-ink-2)]">
            <p className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink)]">Works with</p>
            <span className="flex items-center gap-2"><AppWindow size={13} /> Claude Code · Codex</span>
            <span className="flex items-center gap-2"><Brain size={13} /> Claude · GPT · Groq</span>
            <span className="flex items-center gap-2"><LockKey size={13} /> LM Studio · Ollama</span>
          </div>
        </div>
        <div className="mx-auto max-w-[1360px] px-5 pb-10 sm:px-8 lg:px-9">
          <p className="groove-t flex flex-col justify-between gap-4 border-t border-[var(--color-rule)] pt-5 font-mono text-[11px] leading-[1.8] text-[var(--color-ink-3)] sm:flex-row sm:gap-[30px]">
            <span className="max-w-[80ch]">Use responsibly and in line with local consent laws for recording conversations. PRMPTR is a local tool — you are responsible for how you use its output.</span>
            <span className="whitespace-nowrap">© 2026 · MIT License</span>
          </p>
        </div>
      </footer>
    </main>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-2.5 font-mono text-[12.5px] text-[var(--color-ink-2)]">
      <p className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink)]">{title}</p>
      {links.map(([label, href]) => (
        <a key={label} href={href} className="whitespace-nowrap transition-colors hover:text-[var(--color-accent-text)]">
          {label}
        </a>
      ))}
    </div>
  );
}
