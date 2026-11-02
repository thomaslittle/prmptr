import { describe, expect, it } from "vitest";
import { glossaryLines, glossaryPromptLine, glossaryTerms, MAX_GLOSSARY_TERMS } from "@/lib/glossary";

describe("glossary", () => {
    const text = "Saoirse = Sayers, Sersha\n\n  Kubeflow  \n# a comment\nkubeflow\nQdrant=Drant\r\n";

    it("keeps non-empty, non-comment lines for the engine", () => {
        expect(glossaryLines(text)).toEqual(["Saoirse = Sayers, Sersha", "Kubeflow", "kubeflow", "Qdrant=Drant"]);
    });

    it("extracts de-duplicated terms", () => {
        expect(glossaryTerms(text)).toEqual(["Saoirse", "Kubeflow", "Qdrant"]);
    });

    it("caps the number of lines", () => {
        const many = Array.from({ length: 100 }, (_, i) => `term${i}`).join("\n");
        expect(glossaryLines(many)).toHaveLength(MAX_GLOSSARY_TERMS);
    });

    it("builds a safe prompt line, or nothing when empty", () => {
        expect(glossaryPromptLine("")).toBe("");
        expect(glossaryPromptLine(undefined)).toBe("");
        const line = glossaryPromptLine("Sarah [THEM]\nKubeflow");
        expect(line).toContain("Kubeflow");
        expect(line).not.toContain("[THEM]");
    });
});
