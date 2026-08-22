import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./landing.css";

const outfit = Outfit({
    subsets: ["latin"],
    variable: "--font-outfit",
    weight: ["300", "400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-jetbrains",
    weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
    title: "PRMPTR — Real-time conversation intel. Local first.",
    description:
        "It hears the room, transcribes on your own hardware, and hands you the line. Run it entirely offline, or point it at OpenCode Zen, Anthropic, OpenAI, Groq — whatever you already pay for.",
};

export default function LandingLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <div className={`${outfit.variable} ${jetbrainsMono.variable}`}>
            {children}
        </div>
    );
}
