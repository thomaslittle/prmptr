"use client";

import {
    Ear,
    Lightning,
    ChatCircle,
    PushPin,
    Microphone,
    Cpu,
    ShieldCheck,
    Waveform,
    Globe,
    Lock,
    SpeakerHigh,
    GithubLogo,
    DownloadSimple,
    ArrowRight,
    Sparkle,
} from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RELEASE_URL =
    "https://github.com/thomaslittle/prmptr/releases/tag/v0.1.0";
const REPO_URL = "https://github.com/thomaslittle/prmptr";

const PERSONALITIES = [
    "ROAST MASTER",
    "UNHINGED",
    "WITTY",
    "HYPE MAN",
    "SARCASTIC",
    "PROFESSIONAL",
    "OVER-FRIENDLY",
    "VALLEY GIRL",
    "GRANDPA",
    "ROBOT",
];

const FEATURES = [
    {
        icon: Microphone,
        title: "Ears that never sleep",
        body: "Dual-channel capture of your mic and system audio, gated by Silero VAD and transcribed fully on-device by Moonshine or whisper.cpp.",
    },
    {
        icon: Cpu,
        title: "GPU-fast inference",
        body: "CUDA-accelerated Whisper Large-v3-Turbo on your NVIDIA card, or CPU-friendly Moonshine int8 at ~270ms. Detection diagnostics built in.",
    },
    {
        icon: Sparkle,
        title: "Ten personalities",
        body: "Roast Master to Grandpa to full Unhinged chaos. Each one is a tuned prompt system, not a temperature knob.",
    },
    {
        icon: Globe,
        title: "Every provider",
        body: "OpenCode Zen (including the free tier), Anthropic, OpenAI, Groq, Cerebras — or a local LM Studio server. One key, whole catalog.",
    },
    {
        icon: SpeakerHigh,
        title: "Voice replies",
        body: "Optional spoken delivery through local Kokoro/Sherpa TTS or your own HTTP endpoint. Hands stay free, eyes stay on the call.",
    },
    {
        icon: ShieldCheck,
        title: "Private by design",
        body: "Transcription runs on your machine. Keys live in OS-secure storage. API routes are loopback-only and origin-checked. Nothing syncs.",
    },
];

function Wordmark({ className = "" }: { className?: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <Ear weight="regular" className="-scale-x-100 text-yellow-400" />
            <span className="font-semibold tracking-[0.18em]">PRMPTR</span>
        </span>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <span className="inline-block h-px w-6 bg-primary/60" />
            {children}
        </div>
    );
}

export default function LandingPage() {
    return (
        <main className="noise-bg relative min-h-screen bg-background text-foreground">
            {/* ─── Nav ─── */}
            <nav className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/85 backdrop-blur-sm">
                <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-5">
                    <a href="/landing" className="text-xs">
                        <Wordmark />
                    </a>
                    <div className="hidden items-center gap-6 text-[11px] uppercase tracking-widest text-muted-foreground sm:flex">
                        <a href="#features" className="transition-colors hover:text-foreground">Features</a>
                        <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
                        <a href="#privacy" className="transition-colors hover:text-foreground">Privacy</a>
                        <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 transition-colors hover:text-foreground">
                            <GithubLogo weight="bold" className="size-3.5" /> GitHub
                        </a>
                    </div>
                    <a href={RELEASE_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
                        <DownloadSimple weight="bold" className="size-3.5" />
                        Download
                    </a>
                </div>
            </nav>

            {/* ─── Hero ─── */}
            <section className="relative mx-auto max-w-5xl px-5 pt-32 pb-16">
                <div className="lp-fade mb-5 inline-flex items-center gap-2 border border-border bg-card px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-emerald-400 status-pulse" />
                    v0.1.0 · Windows x64 · MIT licensed
                </div>

                <h1 className="lp-fade max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl" style={{ animationDelay: "80ms" }}>
                    Never miss the{" "}
                    <span className="text-primary">perfect line</span>.
                </h1>

                <p className="lp-fade mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base" style={{ animationDelay: "160ms" }}>
                    PRMPTR listens to the room, transcribes everything locally on
                    your machine, and hands you the exact thing to say — comebacks,
                    answers, facts — before the moment passes.
                </p>

                <div className="lp-fade mt-7 flex flex-wrap items-center gap-2.5" style={{ animationDelay: "240ms" }}>
                    <a href={RELEASE_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "lg" }), "gap-1.5")}>
                        <DownloadSimple weight="bold" className="size-4" />
                        Download for Windows
                    </a>
                    <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "gap-1.5")}>
                        <GithubLogo weight="bold" className="size-4" />
                        Star on GitHub
                    </a>
                    <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                        Free · No account · No cloud required
                    </span>
                </div>

                {/* ─── App mock ─── */}
                <div className="lp-fade lp-scan relative mt-14 border border-border bg-card shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]" style={{ animationDelay: "340ms" }}>
                    {/* window chrome */}
                    <div className="flex items-center gap-1.5 border-b border-border bg-popover px-3 py-2">
                        <span className="size-2 rounded-full bg-destructive/70" />
                        <span className="size-2 rounded-full bg-amber-400/70" />
                        <span className="size-2 rounded-full bg-emerald-400/70" />
                        <span className="ml-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            <Ear weight="regular" className="-scale-x-100 size-3 text-yellow-400" />
                            prmptr — live session
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 audio-meter-chip is-active">
                            <Waveform weight="bold" className="size-2.5" />
                            REC
                            <span className="audio-meter-bars"><i /><i /><i /></span>
                        </span>
                    </div>

                    <div className="grid gap-px bg-border md:grid-cols-[1fr_1.15fr]">
                        {/* transcript feed */}
                        <div className="space-y-2 bg-background p-4 text-xs">
                            <p className="mb-3 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">Live transcript</p>
                            <p><span className="mr-1.5 text-sky-300">[THEM]</span>Okay so walk me through why the stop was even legal?</p>
                            <p><span className="mr-1.5 text-primary">[YOU]</span>I was turning left on a protected—</p>
                            <p><span className="mr-1.5 text-sky-300">[THEM]</span>Protected? There&apos;s no arrow on that street.</p>
                            <p className="text-muted-foreground"><span className="mr-1.5 text-yellow-400">[AUDIO]</span>…unintelligible background chatter…</p>
                            <p className="text-muted-foreground/60 cursor-blink">▍</p>
                        </div>

                        {/* analysis output */}
                        <div className="space-y-3 bg-popover p-4 text-xs">
                            <p className="mb-1 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">Analysis · Roast Master</p>
                            <div className="border-l-2 border-primary/60 pl-2.5">
                                <p className="flex items-center gap-1 font-medium text-primary">
                                    <Lightning weight="fill" /> Say this
                                </p>
                                <p className="mt-1 leading-relaxed text-foreground/90">
                                    &ldquo;There was an arrow until your city repaved it
                                    and forgot — want me to cite the maintenance
                                    records, or are we improvising?&rdquo;
                                </p>
                            </div>
                            <div className="border-l-2 border-sky-400/60 pl-2.5">
                                <p className="flex items-center gap-1 font-medium text-sky-300">
                                    <ChatCircle weight="fill" /> Know this
                                </p>
                                <p className="mt-1 leading-relaxed text-foreground/75">
                                    Protected-left disputes hinge on signal evidence.
                                    Ask which intersection study they relied on.
                                </p>
                            </div>
                            <div className="border-l-2 border-muted-foreground/40 pl-2.5">
                                <p className="flex items-center gap-1 font-medium text-muted-foreground">
                                    <PushPin weight="fill" /> Context
                                </p>
                                <p className="mt-1 leading-relaxed text-foreground/60">
                                    Third traffic-stop question in a row — steer
                                    toward the civil relief angle.
                                </p>
                            </div>
                            <p className="cursor-blink text-primary">▍</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── Stats band ─── */}
            <section className="border-y border-border bg-secondary/40">
                <div className="mx-auto grid max-w-5xl grid-cols-2 px-5 sm:grid-cols-4 sm:divide-x sm:divide-border">
                    {[
                        ["~50ms", "Moonshine STT latency"],
                        ["64", "models via one Zen key"],
                        ["10", "personalities built in"],
                        ["0", "cloud calls by default"],
                    ].map(([stat, label], i) => (
                        <div
                            key={label}
                            className={`px-4 py-5 text-center ${i >= 2 ? "border-t border-border sm:border-t-0" : ""} ${i % 2 === 1 ? "border-l border-border sm:border-l-0" : ""}`}
                        >
                            <p className="text-xl font-semibold text-primary">{stat}</p>
                            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ─── Features ─── */}
            <section id="features" className="mx-auto max-w-5xl scroll-mt-16 px-5 py-20">
                <SectionLabel>Features</SectionLabel>
                <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
                    A full listening post, running on your hardware.
                </h2>
                <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map((f) => (
                        <div key={f.title} className="group bg-background p-5 transition-colors hover:bg-card">
                            <f.icon weight="regular" className="size-5 text-primary transition-transform group-hover:-translate-y-0.5" />
                            <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ─── Personality marquee ─── */}
            <section className="border-y border-border bg-secondary/40 py-8 overflow-hidden">
                <p className="mb-5 text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Pick a voice for every occasion
                </p>
                <div className="overflow-hidden lp-marquee">
                    <div className="lp-marquee-track gap-2.5 pr-2.5">
                        {[...PERSONALITIES, ...PERSONALITIES].map((p, i) => (
                            <span
                                key={`${p}-${i}`}
                                aria-hidden={i >= PERSONALITIES.length}
                                className="whitespace-nowrap border border-border bg-background px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground"
                            >
                                {p}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── How it works ─── */}
            <section id="how" className="mx-auto max-w-5xl scroll-mt-16 px-5 py-20">
                <SectionLabel>How it works</SectionLabel>
                <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
                    Three steps between their question and your answer.
                </h2>
                <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3">
                    {[
                        {
                            n: "01",
                            icon: Microphone,
                            t: "Listen",
                            b: "Your mic and system audio stream into a ring buffer. Silero VAD carves utterances out with pre-onset padding, so first words survive.",
                        },
                        {
                            n: "02",
                            icon: Cpu,
                            t: "Think",
                            b: "Moonshine or whisper.cpp transcribes each segment locally. New dialog goes to your LLM behind a smart gate that knows when to chime in.",
                        },
                        {
                            n: "03",
                            icon: Lightning,
                            t: "Speak",
                            b: "Suggestions land in an always-on-top overlay — sectioned, markdown-clean, optionally read aloud via local TTS.",
                        },
                    ].map((step) => (
                        <div key={step.n} className="bg-background p-5">
                            <div className="flex items-center justify-between">
                                <span className="text-3xl font-semibold text-primary/25">{step.n}</span>
                                <step.icon weight="regular" className="size-5 text-primary" />
                            </div>
                            <h3 className="mt-4 text-sm font-semibold uppercase tracking-widest">{step.t}</h3>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.b}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ─── Privacy ─── */}
            <section id="privacy" className="scroll-mt-16 border-y border-border bg-secondary/40">
                <div className="mx-auto grid max-w-5xl gap-10 px-5 py-20 md:grid-cols-[auto_1fr]">
                    <ShieldCheck weight="regular" className="size-14 text-primary" />
                    <div>
                        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                            Your words never leave the room.
                        </h2>
                        <div className="mt-6 grid gap-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
                            <p>Transcription runs entirely on-device by default — Moonshine or Whisper, no microphone data uploaded, ever.</p>
                            <p>API keys live in OS-secure storage via Tauri, never localStorage. Migrated automatically from older versions.</p>
                            <p>All local API routes are loopback-only, origin-checked, and guarded against SSRF. The dev server binds to 127.0.0.1.</p>
                            <p>Cloud transcription and vision uploads exist as explicit opt-ins — flipping them off returns you to a fully air-gapped flow.</p>
                        </div>
                        <div className="mt-7 flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                                <ShieldCheck weight="bold" className="size-3 text-emerald-400" /> Loopback-only routes
                            </span>
                            <span className="flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                                <Lock weight="bold" className="size-3 text-emerald-400" /> Secure key storage
                            </span>
                            <span className="flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                                <Microphone weight="bold" className="size-3 text-emerald-400" /> On-device STT default
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ─── Final CTA ─── */}
            <section className="mx-auto max-w-5xl px-5 py-24 text-center">
                <SectionLabel>
                    <span className="inline-flex items-center gap-2">
                        <Sparkle weight="fill" className="text-primary" /> Ready when you are
                    </span>
                </SectionLabel>
                <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                    The next conversation starts in seconds.{" "}
                    <span className="text-muted-foreground">Walk in armed.</span>
                </h2>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
                    <a href={RELEASE_URL} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "lg" }), "gap-1.5")}>
                        <DownloadSimple weight="bold" className="size-4" />
                        Download v0.1.0
                    </a>
                    <a href={`${REPO_URL}/contributing`} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "gap-1.5")}>
                        Contribute
                        <ArrowRight weight="bold" className="size-4" />
                    </a>
                </div>
            </section>

            {/* ─── Footer ─── */}
            <footer className="border-t border-border bg-secondary/40">
                <div className="mx-auto max-w-5xl px-5 py-10">
                    <div className="flex flex-col items-start justify-between gap-6 sm:flex-row">
                        <div>
                            <Wordmark className="text-xs" />
                            <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                                Local-first real-time AI assistance. Built with Tauri,
                                Next.js, Rust, whisper.cpp and Moonshine. MIT licensed.
                            </p>
                        </div>
                        <div className="flex gap-10 text-[11px] text-muted-foreground">
                            <div className="space-y-1.5">
                                <p className="uppercase tracking-widest text-foreground/70">Project</p>
                                <a href={REPO_URL} target="_blank" rel="noreferrer" className="block hover:text-foreground">GitHub</a>
                                <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer" className="block hover:text-foreground">Releases</a>
                                <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className="block hover:text-foreground">Issues</a>
                            </div>
                            <div className="space-y-1.5">
                                <p className="uppercase tracking-widest text-foreground/70">Docs</p>
                                <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer" className="block hover:text-foreground">README</a>
                                <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer" className="block hover:text-foreground">Contributing</a>
                                <a href={`${REPO_URL}/security/policy`} target="_blank" rel="noreferrer" className="block hover:text-foreground">Security</a>
                            </div>
                        </div>
                    </div>
                    <p className="mt-8 border-t border-border pt-5 text-[10px] leading-relaxed text-muted-foreground/70">
                        Use responsibly and in accordance with local consent laws for
                        recording conversations. PRMPTR is a local tool — you are
                        responsible for how you use its output. © 2026 · MIT License
                    </p>
                </div>
            </footer>
        </main>
    );
}
