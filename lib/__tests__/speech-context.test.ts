import { describe, expect, it } from "vitest";
import { buildSpeechBiasContext, extractSpeechKeyterms } from "../speech-context";

 describe("speech context biasing", () => {
    it("prioritizes proper nouns, identifiers, versions, and technical terms", () => {
        const terms = extractSpeechKeyterms(
            "Deploy Kubernetes to GreenfieldAudio with decoder_model.ort and PRMPTR v0.1.2. Kubernetes is the target."
        );
        expect(terms).toContain("Kubernetes");
        expect(terms).toContain("GreenfieldAudio");
        expect(terms).toContain("decoder_model.ort");
        expect(terms).toContain("PRMPTR");
    });

    it("combines session and OCR context without including audio transcript text", () => {
        const result = buildSpeechBiasContext({
            sessionContext: "Discuss Project Zephyr and WebRTC",
            feedItems: [
                { id: "ocr", type: "ocr", content: "Moonshine MediumStreaming settings", timestamp: "x", source: "screen", windowName: "VS Code" },
                { id: "audio", type: "audio", content: "do not bias this spoken sentence", timestamp: "x", source: "mic" },
            ],
        });
        expect(result.context).toContain("Project Zephyr");
        expect(result.context).toContain("Moonshine MediumStreaming settings");
        expect(result.context).not.toContain("do not bias this spoken sentence");
    });

    it("bounds decoder context and keyterm cardinality", () => {
        const text = Array.from({ length: 500 }, (_, index) => `UniqueIdentifier${index}`).join(" ");
        const result = buildSpeechBiasContext({ extraText: text, maxContextChars: 4000, maxTerms: 50 });
        expect(result.context.length).toBeLessThanOrEqual(4000);
        expect(result.keyterms.length).toBeLessThanOrEqual(50);
    });
});
