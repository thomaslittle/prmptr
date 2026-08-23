import { describe, expect, it } from "vitest";
import { parseSpeakerDiarizationPreference } from "../speaker-diarization";

describe("parseSpeakerDiarizationPreference", () => {
    it("defaults diarization on when no preference has been stored", () => {
        expect(parseSpeakerDiarizationPreference(null)).toBe(true);
    });

    it.each(["false", "0", "off", "disabled", "no", " FALSE "])(
        "treats %s as disabled",
        (value) => {
            expect(parseSpeakerDiarizationPreference(value)).toBe(false);
        }
    );

    it.each(["true", "1", "on", "enabled", "yes"])(
        "treats %s as enabled",
        (value) => {
            expect(parseSpeakerDiarizationPreference(value)).toBe(true);
        }
    );
});
