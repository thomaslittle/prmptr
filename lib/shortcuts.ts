/**
 * Shortcut parsing and matching utilities.
 * Handles both Tauri-format shortcut strings and browser KeyboardEvents.
 */

export interface ParsedShortcut {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    code: string;
}

const KEY_TO_CODE: Record<string, string> = {
    space: "Space",
    enter: "Enter",
    backspace: "Backspace",
    tab: "Tab",
    escape: "Escape",
    delete: "Delete",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    // Letters a-z
    ...Object.fromEntries(
        Array.from({ length: 26 }, (_, i) => {
            const letter = String.fromCharCode(97 + i);
            return [letter, `Key${letter.toUpperCase()}`];
        })
    ),
    // Digits 0-9
    ...Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [String(i), `Digit${i}`])
    ),
    // F-keys
    ...Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])
    ),
    // Punctuation
    "-": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "`": "Backquote",
};

const CODE_TO_LABEL: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Backspace: "Backspace",
    Tab: "Tab",
    Escape: "Esc",
    Delete: "Del",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
};

/** Parse a Tauri-format shortcut string like "ctrl+shift+space" into components. */
export function parseShortcut(str: string): ParsedShortcut {
    const parts = str.toLowerCase().split("+").map((p) => p.trim());
    const result: ParsedShortcut = {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
        code: "",
    };

    for (const part of parts) {
        if (part === "ctrl" || part === "control") result.ctrl = true;
        else if (part === "shift") result.shift = true;
        else if (part === "alt") result.alt = true;
        else if (part === "meta" || part === "super" || part === "cmd" || part === "command") result.meta = true;
        else result.code = KEY_TO_CODE[part] || part;
    }

    return result;
}

/** Check if a KeyboardEvent matches a parsed shortcut. */
export function matchesKeyboardEvent(
    parsed: ParsedShortcut,
    event: KeyboardEvent
): boolean {
    return (
        event.ctrlKey === parsed.ctrl &&
        event.shiftKey === parsed.shift &&
        event.altKey === parsed.alt &&
        event.metaKey === parsed.meta &&
        event.code === parsed.code
    );
}

/** Convert a KeyboardEvent into a Tauri-format shortcut string. */
export function keyboardEventToShortcutString(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.shiftKey) parts.push("shift");
    if (event.altKey) parts.push("alt");
    if (event.metaKey) parts.push("meta");

    // Reverse-lookup: code → key name
    const code = event.code;
    let keyName = "";
    for (const [name, c] of Object.entries(KEY_TO_CODE)) {
        if (c === code) {
            keyName = name;
            break;
        }
    }
    if (!keyName) keyName = code.toLowerCase();
    parts.push(keyName);

    return parts.join("+");
}

/** Convert a Tauri-format shortcut string to a human-readable label. */
export function shortcutToLabel(str: string): string {
    const parts = str.toLowerCase().split("+").map((p) => p.trim());
    const labels: string[] = [];

    for (const part of parts) {
        if (part === "ctrl" || part === "control") labels.push("Ctrl");
        else if (part === "shift") labels.push("Shift");
        else if (part === "alt") labels.push("Alt");
        else if (part === "meta" || part === "super" || part === "cmd" || part === "command") labels.push("Meta");
        else {
            const code = KEY_TO_CODE[part];
            if (code && CODE_TO_LABEL[code]) {
                labels.push(CODE_TO_LABEL[code]);
            } else if (code?.startsWith("Key")) {
                labels.push(code.slice(3));
            } else if (code?.startsWith("Digit")) {
                labels.push(code.slice(5));
            } else if (code?.startsWith("F") && /^F\d+$/.test(code)) {
                labels.push(code);
            } else {
                labels.push(part.charAt(0).toUpperCase() + part.slice(1));
            }
        }
    }

    return labels.join("+");
}

/**
 * Convert our shortcut format to Tauri global shortcut format.
 * Uses CommandOrControl for cross-platform (Ctrl on Win/Linux, Cmd on Mac).
 */
export function toTauriGlobalShortcut(str: string): string {
    const parts = str.toLowerCase().split("+").map((p) => p.trim());
    const out: string[] = [];
    let keyPart = "";
    for (const part of parts) {
        if (part === "ctrl" || part === "control") out.push("CommandOrControl");
        else if (part === "shift") out.push("Shift");
        else if (part === "alt") out.push("Alt");
        else if (part === "meta" || part === "super" || part === "cmd" || part === "command") out.push("Super");
        else keyPart = part;
    }
    if (keyPart) {
        const code = KEY_TO_CODE[keyPart];
        if (code === "Space") out.push("Space");
        else if (code?.startsWith("Key")) out.push(code.slice(3));
        else if (code?.startsWith("Digit")) out.push(code);
        else if (code?.startsWith("F") && /^F\d+$/.test(code)) out.push(code);
        else out.push(keyPart.charAt(0).toUpperCase() + keyPart.slice(1));
    }
    return out.join("+");
}

/** Check if a keyboard event code is a modifier key (not a "real" key). */
export function isModifierKey(code: string): boolean {
    return (
        code === "ControlLeft" ||
        code === "ControlRight" ||
        code === "ShiftLeft" ||
        code === "ShiftRight" ||
        code === "AltLeft" ||
        code === "AltRight" ||
        code === "MetaLeft" ||
        code === "MetaRight"
    );
}
