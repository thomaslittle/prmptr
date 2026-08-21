import { describe, it, expect } from "vitest";
import {
    parseShortcut,
    matchesKeyboardEvent,
    keyboardEventToShortcutString,
    shortcutToLabel,
    toTauriGlobalShortcut,
    isModifierKey,
} from "../shortcuts";

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        code: "",
        ...overrides,
    } as KeyboardEvent;
}

describe("parseShortcut", () => {
    it("parses modifiers and named keys", () => {
        expect(parseShortcut("ctrl+shift+space")).toEqual({
            ctrl: true,
            shift: true,
            alt: false,
            meta: false,
            code: "Space",
        });
    });

    it("maps letters and digits to codes", () => {
        expect(parseShortcut("alt+k").code).toBe("KeyK");
        expect(parseShortcut("ctrl+7").code).toBe("Digit7");
    });

    it("accepts control/cmd/super aliases", () => {
        expect(parseShortcut("control+a").ctrl).toBe(true);
        expect(parseShortcut("cmd+a").meta).toBe(true);
        expect(parseShortcut("super+a").meta).toBe(true);
    });

    it("passes through unknown keys verbatim", () => {
        expect(parseShortcut("f13").code).toBe("f13");
    });
});

describe("matchesKeyboardEvent", () => {
    const parsed = parseShortcut("ctrl+shift+k");

    it("matches exact modifier + code", () => {
        expect(matchesKeyboardEvent(parsed, keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyK" }))).toBe(true);
    });

    it("rejects missing modifiers", () => {
        expect(matchesKeyboardEvent(parsed, keyEvent({ ctrlKey: true, code: "KeyK" }))).toBe(false);
    });

    it("rejects wrong code", () => {
        expect(matchesKeyboardEvent(parsed, keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyL" }))).toBe(false);
    });
});

describe("keyboardEventToShortcutString", () => {
    it("round-trips with parseShortcut", () => {
        const str = keyboardEventToShortcutString(
            keyEvent({ ctrlKey: true, altKey: true, code: "ArrowDown" })
        );
        expect(str).toBe("ctrl+alt+down");
        expect(parseShortcut(str).code).toBe("ArrowDown");
    });
});

describe("shortcutToLabel", () => {
    it("humanizes keys", () => {
        expect(shortcutToLabel("ctrl+shift+space")).toBe("Ctrl+Shift+Space");
        expect(shortcutToLabel("escape")).toBe("Esc");
        expect(shortcutToLabel("meta+k")).toBe("Meta+K");
        expect(shortcutToLabel("ctrl+-")).toBe("Ctrl+-");
    });
});

describe("toTauriGlobalShortcut", () => {
    it("converts ctrl to CommandOrControl and maps codes", () => {
        expect(toTauriGlobalShortcut("ctrl+shift+k")).toBe("CommandOrControl+Shift+K");
        expect(toTauriGlobalShortcut("ctrl+space")).toBe("CommandOrControl+Space");
        expect(toTauriGlobalShortcut("meta+p")).toBe("Super+P");
        expect(toTauriGlobalShortcut("alt+f5")).toBe("Alt+F5");
    });
});

describe("isModifierKey", () => {
    it("identifies all modifier codes", () => {
        for (const code of ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"]) {
            expect(isModifierKey(code)).toBe(true);
        }
        expect(isModifierKey("KeyA")).toBe(false);
        expect(isModifierKey("Space")).toBe(false);
    });
});
