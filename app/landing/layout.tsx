import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "PRMPTR — Real-time AI conversation wingman",
    description:
        "Listens locally, transcribes on-device, and hands you the perfect thing to say — comebacks, answers, facts — in real time. Moonshine + Whisper STT, GPU-accelerated, private by default.",
};

export default function LandingLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return children;
}
