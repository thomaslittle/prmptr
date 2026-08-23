"use client";

import {
  AirplaneTilt,
  Brain,
  Cpu,
  Crosshair,
  DesktopTower,
  DownloadSimple,
  Ear,
  GithubLogo,
  Globe,
  GraphicsCard,
  Lightning,
  LockKey,
  LockSimple,
  Microphone,
  PlugsConnected,
  Question,
  Sliders,
  Sparkle,
  Stack,
  Timer,
  ToggleRight,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, type CSSProperties, type PropsWithChildren } from "react";

/** Custom PRMPTR ear logo (inline SVG, replaces Phosphor Ear) */
function Logo({ className = "", size = 22, bold = false }: { className?: string; size?: number; bold?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <path fill="currentColor" {...(bold ? { stroke: "currentColor", strokeWidth: "0.5", strokeLinejoin: "round" } : {})} d="m5 13q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7c0-2.4 0.9-4.7 2.6-6.4 1.7-1.7 4-2.6 6.4-2.6 2.4 0 4.7 0.9 6.4 2.6 1.7 1.7 2.6 4 2.6 6.4 0 3.3-1.1 4.4-2.2 5.5-1.1 1-2.3 2.2-2.3 5q0 0.9-0.3 1.7-0.4 0.8-1 1.5-0.7 0.6-1.5 1-0.8 0.3-1.7 0.3c-1.3 0-2.3-0.5-3.2-1.6q-0.3-0.4-0.7-0.4-0.4 0-0.7 0.2-0.4 0.3-0.4 0.7 0 0.4 0.2 0.7 2 2.4 4.8 2.4 1.3 0 2.5-0.5 1.2-0.5 2.1-1.4 0.9-0.9 1.4-2.1 0.5-1.2 0.5-2.5c0-2 0.7-2.7 1.7-3.6 1.2-1.2 2.8-2.7 2.8-6.9 0-2.9-1.2-5.7-3.2-7.8-2.1-2-4.9-3.2-7.8-3.2-2.9 0-5.7 1.2-7.8 3.2-2 2.1-3.2 4.9-3.2 7.8zm4.8 7.1q0.1-0.1 0.3-0.1 0.2 0 0.4 0 0.2 0.1 0.4 0.2 0.1 0.1 0.2 0.3 0.2 0.3 0.5 0.4 0.3 0.2 0.7 0.1 0.3-0.1 0.5-0.4 0.2-0.3 0.2-0.6c0-1.2-0.6-2-1.3-2.9-0.8-1.1-1.7-2.3-1.7-4.1 0-1.6 0.6-3.1 1.8-4.2 1.1-1.2 2.6-1.8 4.2-1.8 1.6 0 3.1 0.6 4.2 1.8 1.2 1.1 1.8 2.6 1.8 4.2q0 0.4-0.3 0.7-0.3 0.3-0.7 0.3-0.4 0-0.7-0.3-0.3-0.3-0.3-0.7c0-1.1-0.4-2.1-1.2-2.8-0.7-0.8-1.7-1.2-2.8-1.2-1.1 0-2.1 0.4-2.8 1.2-0.8 0.7-1.2 1.7-1.2 2.8 0 1.2 0.6 2 1.3 2.9 0.8 1.1 1.7 2.3 1.7 4.1 0 0.7-0.2 1.3-0.6 1.8-0.4 0.5-1 0.9-1.6 1.1-0.7 0.2-1.3 0.1-1.9-0.1-0.7-0.3-1.2-0.7-1.5-1.3q-0.1-0.2-0.1-0.4 0-0.2 0-0.4 0.1-0.1 0.2-0.3 0.1-0.2 0.3-0.3zm10-11.7c1.2 1 2 2.4 2.2 4 0.1 1.6-0.3 3.2-1.3 4.4-1 1.2-2.5 2-4.1 2.2-1.5 0.2-3.1-0.3-4.4-1.3q-0.3-0.3-0.3-0.7-0.1-0.4 0.2-0.7 0.2-0.3 0.7-0.4c0.2 0 0.5 0 0.7 0.2 0.4 0.5 1.9 1 2.9 0.9 1.1-0.1 2-0.6 2.7-1.4 0.7-0.9 1-1.9 0.9-3-0.1-1-0.7-2-1.5-2.7-0.9-0.7-1.3-0.9-2.4-0.9"/>
    </svg>
  );
}

const DOWNLOAD_URL = "https://github.com/thomaslittle/prmptr/releases/tag/v0.1.0";
const REPO_URL = "https://github.com/thomaslittle/prmptr";

const TICKER = [
  "On-device transcription",
  "Works fully offline",
  "Bring your own key",
  "64 models via one Zen key",
  "Ten personalities",
  "Local or hosted, your call",
  "No account required",
  "MIT licensed",
];


const localChain = [
  { icon: Microphone, title: "Capture", meta: "mic + system" },
  { icon: Waveform, title: "VAD gate", meta: "silero" },
  { icon: Cpu, title: "Transcribe", meta: "~50ms" },
  { icon: Lightning, title: "Overlay", meta: "always on top" },
];

const providers = [
  { icon: Sparkle, title: "OpenCode Zen", tag: "Free tier" },
  { icon: Brain, title: "Anthropic · OpenAI", tag: "Your key" },
  { icon: Lightning, title: "Groq · Cerebras", tag: "Fast" },
  { icon: DesktopTower, title: "LM Studio, local", tag: "Air-gapped" },
];

const benefits = [
  {
    icon: AirplaneTilt,
    kicker: "Offline",
    title: "Works on a plane",
    body: "Capture and transcription never need a network, so a dead connection changes nothing about the core loop.",
  },
  {
    icon: LockSimple,
    kicker: "Control",
    title: "You choose the route",
    body: "Local by default, hosted when you want the reach. Keys live in OS-secure storage, not a browser.",
  },
  {
    icon: Timer,
    kicker: "Latency",
    title: "Beats the pause",
    body: "Fifty milliseconds to text, under half a second to a suggestion. Fast enough to use inside a natural gap.",
  },
];

const chips = [
  { icon: Microphone, title: "Dual capture", body: "Mic and system loopback on separate channels, each mutable from the header." },
  { icon: Waveform, title: "Silero VAD", body: "Utterance boundaries with pre-roll padding so first words survive." },
  { icon: Cpu, title: "Moonshine int8", body: "Roughly 6× lower latency than Whisper on CPU, MIT licensed." },
  { icon: GraphicsCard, title: "GPU option", body: "Whisper Large-v3-Turbo on CUDA when a card is available." },
  { icon: Globe, title: "Provider routing", body: "Zen, Anthropic, OpenAI, Groq, Cerebras or a local LM Studio server." },
  { icon: LockKey, title: "OS key storage", body: "Keys held in secure storage, never localStorage." },
];

const steps = [
  {
    n: "01",
    title: "Two small models instead of one large one.",
    body: "Moonshine int8 for speech and a compact model for the reply. Neither needs a data centre, and both fit alongside whatever else you're running.",
  },
  {
    n: "02",
    title: "A gate that knows when to stay quiet.",
    body: "Not every sentence deserves an answer. New dialogue is scored before it reaches a model, so the overlay speaks up on substance instead of on every pause.",
  },
  {
    n: "03",
    title: "Swap the reasoning layer whenever you like.",
    body: "Stay on a local LM Studio server, or route to Zen, Anthropic, OpenAI, Groq and Cerebras with one key. Switch per session, mid-session if you want.",
  },
];

const charts = [
  {
    title: "Time to text",
    rows: [
      { label: "Local Moonshine", pct: "8%", value: "~50 ms", bar: "oklch(0.78 0.155 65)", labelColor: "oklch(0.95 0.008 85)" },
      { label: "Hosted STT", pct: "100%", value: "600 ms+", bar: "oklch(1 0 0 / 26%)", labelColor: "oklch(0.8 0.008 75 / 70%)" },
    ],
  },
  {
    title: "Models reachable",
    rows: [
      { label: "Local only", pct: "6%", value: "1–2", bar: "oklch(0.78 0.155 65)", labelColor: "oklch(0.95 0.008 85)" },
      { label: "With one key", pct: "100%", value: "64", bar: "oklch(0.86 0.14 70 / 55%)", labelColor: "oklch(0.8 0.008 75 / 70%)" },
    ],
  },
  {
    title: "Cost per hour of talking",
    rows: [
      { label: "Local mode", pct: "1%", value: "$0.00", bar: "oklch(0.85 0.16 155)", labelColor: "oklch(0.95 0.008 85)" },
      { label: "Hosted assistant", pct: "100%", value: "$0.40+", bar: "oklch(1 0 0 / 26%)", labelColor: "oklch(0.8 0.008 75 / 70%)" },
    ],
  },
  {
    title: "Install footprint",
    rows: [
      { label: "PRMPTR", pct: "12%", value: "38 MB", bar: "oklch(0.78 0.155 65)", labelColor: "oklch(0.95 0.008 85)" },
      { label: "Whisper large", pct: "100%", value: "1.5 GB", bar: "oklch(1 0 0 / 26%)", labelColor: "oklch(0.8 0.008 75 / 70%)" },
    ],
  },
];

const capabilities = [
  { n: "01", title: "Hears both sides at once.", body: "Dual-channel capture of your microphone and system audio, so calls, rooms and recordings all land in the same transcript." },
  { n: "02", title: "Keeps the first word.", body: "Silero VAD carves utterances with 240ms of pre-onset padding, so openings survive instead of being clipped by the gate." },
  { n: "03", title: "Presets for the situation.", body: "Interview, roleplay, meeting, podcast, lecture or general — each one loads its own context prompt, which you can edit inline." },
  { n: "04", title: "Ten personalities, tuned not tweaked.", body: "Roast Master through Grandpa to Unhinged. Each is a full prompt system with its own register, not a temperature slider." },
  { n: "05", title: "Speaks the answer if you want.", body: "Optional delivery through bundled Sherpa/Kokoro, or your own endpoint, with accent, voice, rate and volume all adjustable." },
  { n: "06", title: "Manual, auto or smart triggers.", body: "Fire on a shortcut, on a timer you set, or let the gate decide. Interval and context size are sliders, not guesses." },
];

const stats = [
  { key: "Latency", value: "~50ms", note: "Speech to text, local CPU" },
  { key: "Offline", value: "Full", note: "No network needed to run" },
  { key: "Models", value: "64", note: "Through one Zen key" },
  { key: "Base cost", value: "$0", note: "MIT, no account, no meter" },
];

const faqs = [
  { n: "01", question: "What is PRMPTR?", answer: "PRMPTR is your conversation copilot — a desktop app that listens to your microphone and system audio, transcribes both, and shows suggested things to say in an always-on-top overlay. Visit prmptr.cc for more." },
  { n: "02", question: "Does it need the cloud?", answer: "No. Transcription runs on-device by default and the app is usable with no key at all. Hosted transcription and hosted models are opt-in switches for when you want more reach." },
  { n: "03", question: "Which providers can I use?", answer: "OpenCode Zen — including its free tier — plus Anthropic, OpenAI, Groq and Cerebras, or a local LM Studio server. One Zen key opens roughly sixty-four models." },
  { n: "04", question: "What hardware does it need?", answer: "Any modern Windows x64 machine. Moonshine int8 runs on CPU in about 50ms. If you have an NVIDIA card, Whisper Large-v3-Turbo can run on CUDA instead." },
  { n: "05", question: "Where do my API keys live?", answer: "In OS-secure storage, never in localStorage, and they migrate automatically from older versions. Local API routes are loopback-only and origin-checked." },
  { n: "06", question: "What does it cost?", answer: "The app is free and MIT licensed, with no account and no usage meter. If you route to a hosted provider you pay that provider directly." },
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
  return <div className={`[box-shadow:inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] mx-auto box-border max-w-[1360px] border-x border-white/10 px-5 py-16 sm:px-8 lg:px-9 lg:py-[88px] ${className}`}>{children}</div>;
}

function Eyebrow({ icon: Icon, children }: PropsWithChildren<{ icon: typeof X }>) {
  return (
    <span className="inline-flex items-center gap-2 border border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">
      <Icon size={12} weight="bold" />
      {children}
    </span>
  );
}

function CutCard({ children, innerClassName = "" }: PropsWithChildren<{ innerClassName?: string }>) {
  return (
    <div className="h-full">
      <div className={`prmptr-cut-card-inner h-full border border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] bg-[oklch(0.2_0.004_60)] ${innerClassName}`}>{children}</div>
    </div>
  );
}

function DuplexHelix({ active = true, points = 44 }: { active?: boolean; points?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: points }, (_, i) => ({
        phase: `${(-i * 0.055).toFixed(3)}s`,
        amplitude: Math.round(
          18 + Math.abs(Math.sin(i * 0.38)) * 14 + Math.abs(Math.cos(i * 0.17)) * 8,
        ),
      })),
    [points],
  );

  return (
    <span className="relative h-24 min-w-0 flex-1" aria-hidden="true">
      <span className="absolute inset-x-3 inset-y-0 flex items-center">
        {dots.map((dot, i) => (
          <span
            key={i}
            className="relative h-full flex-1"
            style={{ "--phase": dot.phase, "--amplitude": `${dot.amplitude}px` } as CSSProperties}
          >
            <i
              className={`duplex-helix-a absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,.45)] ${active ? "is-active" : ""}`}
            />
            <i
              className={`duplex-helix-b absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-orange-500/70 shadow-[0_0_10px_rgba(249,115,22,.25)] ${active ? "is-active" : ""}`}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

export default function PrmptrLanding({
  motion = true,
  mainScreenshot = "/uploads/pasted-1787396485869-0.png",
  captureScreenshot = "/uploads/pasted-1787396500853-0.png",
  voiceScreenshot = "/uploads/pasted-1787396515198-0.png",
}: LandingProps) {
  const tickerLoop = useMemo(() => [...TICKER, ...TICKER], []);

  return (
    <main className="prmptr-page relative min-h-screen overflow-x-hidden bg-[oklch(0.225_0.004_60)] text-[oklch(0.95_0.008_85)] selection:bg-[oklch(0.78_0.155_65/35%)]">
      <div className="prmptr-grain pointer-events-none fixed inset-0 z-[900] opacity-[0.075]" aria-hidden="true" />

      <section id="top" className="prmptr-amber-pattern relative overflow-hidden text-[oklch(0.16_0.012_55)]">
        <Logo className="pointer-events-none absolute -right-[110px] -top-[70px] hidden h-[1000px] w-[1000px]  text-white/15 lg:block" aria-hidden="true" />

        <nav className="relative mx-auto flex max-w-[1360px] items-center justify-between px-5 pt-6 sm:px-8 lg:px-9">
          <a href="#top" className="flex items-center gap-2.5 hover:text-current">
            <Logo size={22} bold className="" />
            <span className="text-[21px] font-semibold tracking-[0.06em]" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>PRMPTR<span className="sr-only">.cc</span></span>
          </a>

          <div className="flex items-center gap-4 font-mono text-xs sm:gap-6">
            <a href="#app" className="hidden hover:text-current md:inline">The app</a>
            <a href="#faq" className="hidden hover:text-current md:inline">FAQ</a>
            <a href={REPO_URL} className="hidden hover:text-current sm:inline">Source</a>
            <span className="prmptr-nav-button-wrap bg-[oklch(0.16_0.012_55)] p-px">
              <a href={DOWNLOAD_URL} className="prmptr-nav-button inline-flex h-[38px] items-center bg-[oklch(0.16_0.012_55)] px-4 font-bold text-white hover:bg-[oklch(0.78_0.155_65)] hover:text-[oklch(0.16_0.012_55)] sm:px-5">
                <span className="sm:hidden">Download</span>
                <span className="hidden sm:inline">Download v0.1.0</span>
              </a>
            </span>
          </div>
        </nav>

        <div className="relative mx-auto max-w-[1360px] px-5 pb-20 pt-20 sm:px-8 lg:px-9 lg:pb-[92px] lg:pt-[100px]">
          <h1 className={`${motion ? "prmptr-rise" : ""} max-w-[17ch] text-[clamp(3rem,6.4vw,6rem)] font-medium leading-[0.92] tracking-[-0.03em]`}>
            Your <span className="cc-glow">c</span>onversation <span className="cc-glow">c</span>opilot.
          </h1>
          <p className={`${motion ? "prmptr-rise prmptr-rise-delay-1" : ""} mt-8 max-w-[48ch] text-[17px] leading-[1.55] sm:text-[19px]`}>
            PRMPTR listens to your mic and system audio, transcribes on your own hardware, and surfaces the right line before the moment passes. Run it offline, or plug in a provider key — your call.
          </p>
          <div className={`${motion ? "prmptr-rise prmptr-rise-delay-2" : ""} mt-10 flex flex-wrap gap-4`}>
            <span className="bg-[oklch(0.16_0.012_55)] p-px prmptr-cut-button-wrap">
              <a
                href={DOWNLOAD_URL}
                className="prmptr-cut-button inline-flex h-[54px] items-center gap-2.5 px-7 font-mono text-[13px] font-bold bg-[oklch(0.16_0.012_55)] text-white hover:bg-[oklch(0.78_0.155_65)] hover:text-[oklch(0.16_0.012_55)]"
              >
                <DownloadSimple size={17} weight="bold" />
                Download for Windows
              </a>
            </span>
            <span className="bg-[oklch(0.16_0.012_55/55%)] p-px prmptr-cut-button-wrap">
              <a
                href="#app"
                className="prmptr-cut-button inline-flex h-[54px] items-center gap-2.5 px-7 font-mono text-[13px] font-bold bg-[oklch(0.78_0.155_65)] text-[oklch(0.16_0.012_55)] hover:bg-[oklch(0.16_0.012_55)] hover:text-white"
              >
                See it running
              </a>
            </span>
          </div>
        </div>

      </section>

      <section className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10 bg-[oklch(0.165_0.004_60)]">
        <div className="mx-auto flex max-w-[1360px] items-center gap-4 px-5 py-5 sm:px-8 lg:gap-[30px] lg:px-9 lg:py-[26px]">
          <span className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">
            <span className={`${motion ? "prmptr-pulse" : ""} h-[7px] w-[7px] rounded-full bg-[oklch(0.85_0.16_155)]`} />
            Listening
          </span>
          <DuplexHelix active={motion} />
          <span className="hidden shrink-0 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.16em] text-[oklch(0.8_0.008_75/65%)] lg:inline">
            Moonshine int8 · ~50ms · on device · <span className="text-[#76b900]">CUDA</span> ready
          </span>
        </div>
      </section>

      <section id="local" className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10 bg-[oklch(0.205_0.004_60)]">
        <SectionShell>
          <div className="flex justify-center"><Eyebrow icon={PlugsConnected}>Local first, not local only</Eyebrow></div>
          <h2 className="mx-auto mt-10 max-w-[22ch] text-center text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.03em]">Everything works offline. Plug in more when you want it.</h2>
          <p className="mx-auto mt-5 max-w-[64ch] text-center text-[17px] leading-[1.6] text-[oklch(0.8_0.008_75/80%)]">Capture, gating and transcription always run on your machine. The reasoning step is yours to choose: a local model, or a provider key you already have.</p>

          <div className="mt-12 grid overflow-hidden border border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] bg-[oklch(0.19_0.004_60)] lg:grid-cols-[1fr_172px_1fr]">
            <div className="p-6 sm:p-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[oklch(0.82_0.15_68)]">Always on your machine</p>
              <div className="mt-5 flex flex-col gap-2.5">
                {localChain.map(({ icon: Icon, title, meta }) => (
                  <div key={title} className="prmptr-small-cut bg-[oklch(0.78_0.155_65/40%)] p-px">
                    <div className="prmptr-small-cut-inner flex items-center gap-3.5 bg-[oklch(0.225_0.02_62)] p-3.5 sm:px-4">
                      <Icon size={19} className="shrink-0 text-[oklch(0.82_0.15_68)]" />
                      <span className="flex-1 font-mono text-[12.5px] uppercase tracking-[0.1em]">{title}</span>
                      <span className="font-mono text-[11px] text-[oklch(0.8_0.008_75/65%)]">{meta}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[oklch(0.85_0.16_155)]">✓ No key needed to get going</p>
            </div>

            <div className="flex items-center justify-center gap-4 border-y border-white/10 bg-[oklch(0.175_0.004_60)] p-5 lg:flex-col lg:border-x lg:border-y-0 lg:px-0 lg:py-8 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60)] lg:[box-shadow:inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)]">
              <span className="h-px flex-1 bg-[oklch(0.8_0.008_75/22%)] lg:h-auto lg:w-px" />
              <span className="flex flex-col items-center gap-2 border border-[oklch(0.78_0.155_65/50%)] bg-[oklch(0.78_0.155_65/12%)] px-4 py-3.5 text-center">
                <ToggleRight size={22} weight="bold" className="text-[oklch(0.82_0.15_68)]" />
                <span className="font-mono text-[9.5px] uppercase leading-[1.5] tracking-[0.16em] text-[oklch(0.82_0.15_68)]">Your<br />call</span>
              </span>
              <span className="h-px flex-1 bg-[oklch(0.8_0.008_75/22%)] lg:h-auto lg:w-px" />
            </div>

            <div className="p-6 sm:p-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[oklch(0.8_0.008_75/75%)]">Optional, if you want the reach</p>
              <div className="mt-5 flex flex-col gap-2.5">
                {providers.map(({ icon: Icon, title, tag }) => (
                  <div key={title} className="flex items-center gap-3.5 border border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] p-3.5 sm:px-4">
                    <Icon size={19} className="shrink-0 text-[oklch(0.8_0.008_75/80%)]" />
                    <span className="flex-1 font-mono text-[12.5px] uppercase tracking-[0.1em] text-[oklch(0.9_0.008_80/90%)]">{title}</span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[oklch(0.8_0.008_75/60%)]">{tag}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[oklch(0.8_0.008_75/70%)]">One key, 64 models</p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-3 lg:gap-[22px]">
            {benefits.map(({ icon: Icon, kicker, title, body }) => (
              <Reveal key={title} enabled={motion}>
                <CutCard innerClassName="p-7 text-center sm:px-[30px] sm:pb-8">
                  <span className="inline-flex items-center gap-2 border border-[oklch(0.78_0.155_65/45%)] px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[oklch(0.82_0.15_68)]">
                    <Icon size={12} weight="bold" />{kicker}
                  </span>
                  <h3 className="mt-5 text-[26px] font-medium tracking-[-0.025em]">{title}</h3>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-[oklch(0.8_0.008_75/78%)] [text-wrap:pretty]">{body}</p>
                </CutCard>
              </Reveal>
            ))}
          </div>
        </SectionShell>
      </section>

      <section id="app" className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10">
        <SectionShell>
          <div className="flex justify-center"><Eyebrow icon={Sliders}>The app</Eyebrow></div>
          <h2 className="mx-auto mt-10 text-center text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.03em]">Three panes: the room, the answer, the knobs.</h2>
          <p className="mx-auto mt-5 max-w-[62ch] text-center text-[17px] leading-[1.6] text-[oklch(0.8_0.008_75/80%)]">Transcript on the left, suggestions in the middle, everything tunable on the right — session preset, model, trigger mode, personality, response style.</p>

          <div className="prmptr-window-cut mt-12 bg-white/15 p-px">
            <div className="prmptr-window-cut-inner bg-[oklch(0.15_0.004_60)]">
              <div className="flex items-center gap-2 border-b border-white/10 [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[oklch(0.8_0.008_75/60%)] sm:text-[11px]">
                <span className="h-[9px] w-[9px] rounded-full bg-[oklch(0.62_0.2_25/70%)]" />
                <span className="h-[9px] w-[9px] rounded-full bg-[oklch(0.83_0.16_82/70%)]" />
                <span className="h-[9px] w-[9px] rounded-full bg-[oklch(0.85_0.16_155/70%)]" />
                <span className="ml-2 hidden sm:inline">prmptr.cc — live session · interview preset</span>
                <span className="ml-auto text-[oklch(0.82_0.15_68)]">● Recording</span>
              </div>
              <img src={mainScreenshot} alt="PRMPTR main window: feed, analysis and configuration panes" className="block h-auto w-full" />
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2 lg:gap-[22px]">
            <Reveal enabled={motion}>
              <CutCard innerClassName="overflow-hidden bg-[oklch(0.15_0.004_60)] p-0">
                <img src={captureScreenshot} alt="Settings: capture and voice, transcription mode and engine" className="block h-auto w-full" />
                <div className="[box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)] border-t border-white/10 px-5 pb-5 pt-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">Capture & voice</p>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[oklch(0.8_0.008_75/80%)]">Pick your devices, then pick the engine. Local Whisper or Moonshine by default; Deepgram and Screenpipe are there if you want them.</p>
                </div>
              </CutCard>
            </Reveal>
            <Reveal enabled={motion}>
              <CutCard innerClassName="overflow-hidden bg-[oklch(0.15_0.004_60)] p-0">
                <img src={voiceScreenshot} alt="Settings: TTS voice reply configuration" className="block h-auto w-full" />
                <div className="[box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)] border-t border-white/10 px-5 pb-5 pt-4">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">Voice reply</p>
                  <p className="mt-2.5 text-[14.5px] leading-[1.6] text-[oklch(0.8_0.008_75/80%)]">Bundled Sherpa/Kokoro speaks each reply through your output, with accent, voice, rate and volume under your control.</p>
                </div>
              </CutCard>
            </Reveal>
          </div>

          <div className="mt-5 grid overflow-hidden border border-white/10 bg-white/15 sm:grid-cols-2 lg:grid-cols-3 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)]">
            {chips.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-2.5 border-b border-r border-white/10 [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] bg-[oklch(0.19_0.004_60)] p-5 sm:p-6">
                <Icon size={20} className="text-[oklch(0.82_0.15_68)]" />
                <p className="text-[17px] font-medium tracking-[-0.02em]">{title}</p>
                <p className="text-[13px] leading-[1.6] text-[oklch(0.8_0.008_75/75%)]">{body}</p>
              </div>
            ))}
          </div>
        </SectionShell>
      </section>

      <section className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10 bg-[oklch(0.205_0.004_60)]">
        <SectionShell>
          <div className="flex justify-center"><Eyebrow icon={Crosshair}>Our approach</Eyebrow></div>
          <h2 className="mx-auto mt-10 text-center text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.03em]">Small models, close to the mic.</h2>
          <div className="mt-12 grid lg:grid-cols-[1.05fr_1fr] lg:mt-14">
            <div className="border-t border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)]">
              {steps.map((step) => (
                <Reveal key={step.n} enabled={motion} className="border-b border-l-2 border-b-white/10 border-l-[oklch(0.78_0.155_65/70%)] [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] py-6 pl-6 sm:py-7">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">Step {step.n}</p>
                  <h3 className="mt-3.5 max-w-[32ch] text-[25px] font-medium leading-[1.08] tracking-[-0.025em]">{step.title}</h3>
                  <p className="mt-3.5 max-w-[52ch] text-[15px] leading-[1.7] text-[oklch(0.8_0.008_75/78%)] [text-wrap:pretty]">{step.body}</p>
                </Reveal>
              ))}
            </div>

            <CutCard innerClassName="bg-[oklch(0.19_0.004_60)] p-6 sm:p-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em]">Local mode, laptop, no GPU</p>
              <div className="mt-6 flex flex-col gap-6 font-mono">
                {charts.map((chart) => (
                  <div key={chart.title}>
                    <p className="mb-3 text-[11.5px] uppercase tracking-[0.14em] text-[oklch(0.8_0.008_75/80%)]">{chart.title}</p>
                    <div className="flex flex-col gap-2">
                      {chart.rows.map((row) => (
                        <div key={row.label} className="grid grid-cols-[105px_1fr_auto] items-center gap-3 text-[10.5px] sm:grid-cols-[124px_1fr_auto] sm:text-[11.5px]">
                          <span style={{ color: row.labelColor }}>{row.label}</span>
                          <span className="relative block h-2.5 bg-white/10">
                            <i className="absolute inset-y-0 left-0 block" style={{ width: row.pct, background: row.bar }} />
                          </span>
                          <span className="min-w-[62px] text-right sm:min-w-[76px]" style={{ color: row.labelColor }}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* CUDA badge */}
              <div className="mt-7 flex items-center gap-4 border-t border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)] pt-5">
                <svg viewBox="590 230 900 620" width="52" height="36" aria-hidden="true">
                  <path fill="#76b900" d="M1065.22873,425.14577v-54.92689c5.32957-.37764,10.71688-.6626,16.20671-.83601,150.22334-4.72073,248.78057,129.07979,248.78057,129.07979,0,0-106.44633,147.84488-220.57771,147.84488-16.43786,0-31.14868-2.64945-44.40957-7.10172v-166.55441c58.48096,7.06441,70.23929,32.89765,105.40881,91.50382l78.19751-65.93138s-57.08111-74.86559-153.30623-74.86559c-10.47061,0-20.47697.73841-30.30009,1.78751M1065.22873,243.70607v82.0431c5.39104-.42772,10.78876-.76806,16.20671-.96562,208.90854-7.0375,345.01061,171.32778,345.01061,171.32778,0,0-156.33251,190.0968-319.19248,190.0968-14.92371,0-28.89631-1.37804-42.02484-3.70247v50.71342c11.22808,1.42675,22.85778,2.26787,34.99494,2.26787,151.56388,0,261.16891-77.39426,367.30475-169.00355,17.58279,14.09032,89.62866,48.36503,104.44416,63.3874-100.92116,84.47674-336.09264,152.56464-469.4168,152.56464-12.84867,0-25.2054-.77474-37.32704-1.94089v71.27251h576.05304V243.70607h-576.05304ZM1065.22873,639.20582v43.29984c-140.18046-24.99212-179.08606-170.70641-179.08606-170.70641,0,0,67.30211-74.57022,179.08606-86.65348v47.50564c-.08739,0-.14395-.022-.21976-.022-58.65535-7.04516-104.48913,47.76369-104.48913,47.76369,0,0,25.6781,92.2603,104.70889,118.81271M816.2553,505.48484s83.0803-122.59099,248.97342-135.26596v-44.46971c-183.74262,14.74528-342.85899,170.36216-342.85899,170.36216,0,0,90.11413,260.53312,342.85899,284.38323v-47.27548c-185.46867-23.33521-248.97342-227.73423-248.97342-227.73423Z"/>
                </svg>
                <div>
                  <p className="font-mono text-[13px] font-bold tracking-[0.08em] text-[#76b900]">NVIDIA CUDA</p>
                  <p className="mt-0.5 text-[11px] text-[oklch(0.8_0.008_75/70%)]">GPU-accelerated inference when a card is present</p>
                </div>
              </div>
            </CutCard>
          </div>
        </SectionShell>
      </section>

      <section id="capabilities" className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10">
        <SectionShell className="pb-0">
          <div className="flex justify-center"><Eyebrow icon={Stack}>Capabilities</Eyebrow></div>
          <h2 className="mx-auto mt-10 text-center text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.03em]">Your hardware, unleashed.</h2>
          <div className="mt-12 grid border-y border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60)] md:grid-cols-2 lg:grid-cols-3 lg:mt-14">
            {capabilities.map((capability) => (
              <Reveal key={capability.n} enabled={motion}>
                <div className="border border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] p-7 sm:px-[30px] sm:pb-8">
                  <div className="flex items-start justify-between">
                    <h3 className="text-[22px] font-medium leading-[1.1] tracking-[-0.025em]">{capability.title}</h3>
                    <span className="ml-4 shrink-0 font-mono text-[11px] tabular-nums text-[oklch(0.8_0.008_75/30%)]">{capability.n}</span>
                  </div>
                  <p className="mt-3 text-[14.5px] leading-[1.65] text-[oklch(0.8_0.008_75/78%)] [text-wrap:pretty]">{capability.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </SectionShell>

        <div className="mx-auto mt-14 grid max-w-[1360px] border-y border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60),inset_0_-1px_0_oklch(0.115_0.004_60)] sm:grid-cols-2 lg:mt-[68px] lg:grid-cols-4">
          {stats.map((stat, i) => (
            <div key={stat.key} className={`border-t border-r border-b border-white/10 [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60)] px-5 py-7 sm:px-8 lg:px-9 lg:py-[30px]${i === 0 ? " border-l [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60),inset_-1px_0_0_oklch(0.115_0.004_60),inset_1px_0_0_oklch(0.115_0.004_60)]" : ""}`}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[oklch(0.82_0.15_68)]">{stat.key}</p>
              <p className="mt-4 text-[42px] font-medium leading-none tracking-[-0.035em] lg:text-[46px]">{stat.value}</p>
              <p className="mt-3 font-mono text-[11.5px] text-[oklch(0.8_0.008_75/70%)]">{stat.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="[box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] border-b border-white/10 bg-[oklch(0.205_0.004_60)]">
        <SectionShell className="grid gap-12 lg:grid-cols-[0.6fr_1fr] lg:gap-[72px]">
          <div>
            <Eyebrow icon={Question}>FAQ</Eyebrow>
            <h2 className="mt-[30px] text-[clamp(2.5rem,4vw,3.5rem)] font-medium leading-[0.92] tracking-[-0.03em]">Frequently asked questions.</h2>
            <p className="mt-5 max-w-[34ch] text-[15px] leading-[1.7] text-[oklch(0.8_0.008_75/75%)]">Everything else lives in the README. Issues and pull requests are open.</p>
          </div>
          <div className="border-t border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)]">
            {faqs.map((faq) => (
              <div key={faq.n} className="grid grid-cols-[44px_1fr] gap-2 border-b border-white/10 [box-shadow:inset_0_-1px_0_oklch(0.115_0.004_60)] py-6 sm:grid-cols-[54px_1fr]">
                <span className="pt-1.5 font-mono text-xs text-[oklch(0.82_0.15_68)]">{faq.n}</span>
                <div>
                  <h3 className="text-xl font-medium tracking-[-0.02em]">{faq.question}</h3>
                  <p className="mt-3 max-w-[70ch] text-[14.5px] leading-[1.75] text-[oklch(0.8_0.008_75/78%)] [text-wrap:pretty]">{faq.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionShell>
      </section>

      <section className="prmptr-amber-pattern relative overflow-hidden text-[oklch(0.16_0.012_55)]">
        <Logo className="pointer-events-none absolute -bottom-[190px] -left-[160px] hidden h-[620px] w-[620px]  text-[oklch(0.16_0.012_55/8%)] lg:block" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-[1360px] flex-col items-center px-5 py-20 text-center sm:px-8 lg:px-9 lg:pb-24 lg:pt-[88px]">
          <Logo size={132} className="" />
          <h2 className="mx-auto mt-[30px] max-w-[20ch] text-[clamp(2.75rem,5.2vw,4.75rem)] font-medium leading-[0.92] tracking-[-0.03em]">Your copilot, ready when you are.</h2>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <span className="bg-[oklch(0.16_0.012_55)] p-px prmptr-cut-button-wrap">
              <a
                href={DOWNLOAD_URL}
                className="prmptr-cut-button inline-flex h-[54px] items-center gap-2.5 px-7 font-mono text-[13px] font-bold bg-[oklch(0.16_0.012_55)] text-white hover:bg-[oklch(0.78_0.155_65)] hover:text-[oklch(0.16_0.012_55)]"
              >
                <DownloadSimple size={17} weight="bold" />
                Download v0.1.0
              </a>
            </span>
            <span className="bg-[oklch(0.16_0.012_55/55%)] p-px prmptr-cut-button-wrap">
              <a
                href={REPO_URL}
                className="prmptr-cut-button inline-flex h-[54px] items-center gap-2.5 px-7 font-mono text-[13px] font-bold bg-[oklch(0.78_0.155_65)] text-[oklch(0.16_0.012_55)] hover:bg-[oklch(0.16_0.012_55)] hover:text-white"
              >
                <GithubLogo size={17} weight="bold" />
                Read the source
              </a>
            </span>
          </div>
          <p className="mt-5 font-mono text-xs uppercase tracking-[0.16em] opacity-70">No account. 38 MB. Bring your own key, or don&apos;t.</p>
        </div>
      </section>

      <footer className="bg-[oklch(0.185_0.004_60)]">
        <div className="mx-auto grid max-w-[1360px] gap-9 px-5 pb-6 pt-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:px-9 lg:pt-14">
          <div>
            <span className="flex items-center gap-2.5"><Logo size={20} bold className=" text-[oklch(0.82_0.15_68)]" /><span className="text-lg font-semibold tracking-[0.06em]" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>PRMPTR<span className="sr-only">.cc</span></span></span>
            <p className="mt-4 max-w-[32ch] text-sm leading-[1.7] text-[oklch(0.8_0.008_75/72%)]">Your conversation copilot. Local first, open source, MIT licensed.</p>
          </div>
          <FooterColumn title="Project" links={[['GitHub', REPO_URL], ['Releases', `${REPO_URL}/releases`], ['Issues', `${REPO_URL}/issues`]]} />
          <FooterColumn title="Docs" links={[['README', `${REPO_URL}#readme`], ['Contributing', `${REPO_URL}/blob/main/CONTRIBUTING.md`], ['Security', `${REPO_URL}/security/policy`]]} />
          <div className="flex flex-col gap-2.5 font-mono text-[12.5px] text-[oklch(0.8_0.008_75/72%)]">
            <p className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-[oklch(0.95_0.008_85)]">Providers</p>
            <span>OpenCode Zen</span>
            <span>Anthropic · OpenAI</span>
            <span>Groq · Cerebras · LM Studio</span>
          </div>
        </div>
        <div className="mx-auto max-w-[1360px] px-5 pb-10 sm:px-8 lg:px-9">
          <p className="flex flex-col justify-between gap-4 border-t border-white/10 [box-shadow:inset_0_1px_0_oklch(0.115_0.004_60)] pt-5 font-mono text-[11px] leading-[1.8] text-[oklch(0.8_0.008_75/60%)] sm:flex-row sm:gap-[30px]">
            <span className="max-w-[80ch]">Use responsibly and in accordance with local consent laws for recording conversations. PRMPTR is a local tool — you are responsible for how you use its output. prmptr.cc</span>
            <span className="whitespace-nowrap">© 2026 · MIT License</span>
          </p>
        </div>
      </footer>
    </main>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div className="flex flex-col gap-2.5 font-mono text-[12.5px] text-[oklch(0.8_0.008_75/72%)]">
      <p className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-[oklch(0.95_0.008_85)]">{title}</p>
      {links.map(([label, href]) => <a key={label} href={href} className="transition-colors hover:text-[oklch(0.82_0.15_68)]">{label}</a>)}
    </div>
  );
}
