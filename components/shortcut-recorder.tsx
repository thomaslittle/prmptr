"use client";

import { useState, useCallback, useRef } from "react";
import { isModifierKey, keyboardEventToShortcutString, shortcutToLabel } from "@/lib/shortcuts";

interface ShortcutRecorderProps {
    value: string;
    label: string;
    onChange: (keys: string, label: string) => void;
}

export default function ShortcutRecorder({ value, label, onChange }: ShortcutRecorderProps) {
    const [recording, setRecording] = useState(false);
    const [modifierPreview, setModifierPreview] = useState("");
    const divRef = useRef<HTMLDivElement>(null);

    const startRecording = useCallback(() => {
        setRecording(true);
        setModifierPreview("");
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.code === "Escape") {
                setRecording(false);
                setModifierPreview("");
                return;
            }

            if (isModifierKey(e.nativeEvent.code)) {
                // Show live modifier preview
                const parts: string[] = [];
                if (e.ctrlKey) parts.push("Ctrl");
                if (e.shiftKey) parts.push("Shift");
                if (e.altKey) parts.push("Alt");
                if (e.metaKey) parts.push("Meta");
                setModifierPreview(parts.join("+") + "+...");
                return;
            }

            // Non-modifier key pressed — save the combo
            const keys = keyboardEventToShortcutString(e.nativeEvent);
            const newLabel = shortcutToLabel(keys);
            onChange(keys, newLabel);
            setRecording(false);
            setModifierPreview("");
        },
        [onChange]
    );

    const handleKeyUp = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            e.stopPropagation();
            if (!recording) return;
            // Update modifier preview on key release
            const parts: string[] = [];
            if (e.ctrlKey) parts.push("Ctrl");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey) parts.push("Alt");
            if (e.metaKey) parts.push("Meta");
            setModifierPreview(parts.length > 0 ? parts.join("+") + "+..." : "");
        },
        [recording]
    );

    return (
        <div
            ref={divRef}
            data-shortcut-recorder
            tabIndex={0}
            role="button"
            className={
                "inline-flex items-center px-2 py-1 text-xs border rounded cursor-pointer min-w-[120px] justify-center transition-colors " +
                (recording
                    ? "border-primary bg-primary/10 text-primary outline-none ring-1 ring-primary"
                    : "border-border hover:bg-muted")
            }
            onClick={() => !recording && startRecording()}
            onFocus={() => !recording && startRecording()}
            onBlur={() => {
                setRecording(false);
                setModifierPreview("");
            }}
            onKeyDown={recording ? handleKeyDown : undefined}
            onKeyUp={recording ? handleKeyUp : undefined}
        >
            {recording
                ? modifierPreview || "Press shortcut..."
                : label}
        </div>
    );
}
