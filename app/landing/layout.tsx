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
    title: "PRMPTR — Your Conversation Copilot",
    description:
        "PRMPTR listens to your mic and system audio, transcribes on-device, and surfaces the right line before the moment passes. Local first, open source, yours to extend.",
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
