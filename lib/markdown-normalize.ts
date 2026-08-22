/**
 * Some models emit markdown glued into a single line:
 *   ...relevance here?"**What you can say:**1. **"quote one"**2. ...
 *   ...leave."---**⚠️ CHECK:**text...yourself.****🔥 CLOSER:"quote"
 * CommonMark can't recover block structure from glued lines (bold/list/hr
 * need line starts), so `**`, `---` and `1.` render literally.
 *
 * Normalization ONLY activates in "glued mode" (no blank-line block
 * separation present), so well-formed multi-line markdown passes through
 * completely untouched.
 */
export function normalizeGluedMarkdown(src: string): string {
    // Gate: real block separation exists → trust the model's formatting.
    // Glued emissions never contain blank lines.
    if (src.includes("\n\n")) return src;

    let s = src;

    // Prose jammed against colon-closing labels, both star orders:
    //   **CHECK:**They're…   |   …(OPTION):"Fuck right off…
    s = s.replace(/:\*\*(?=[A-Z“"])/g, ":**\n");
    s = s.replace(/:"(?=[A-Z“"])/g, ':"\n');

    // Collided block boundaries render as runs of consecutive stars
    // (closer+opener fused): ...explain yourself.****🔥 GO-TO...
    // Collapse to a clean break; lookahead skips list numbers so the
    // numbered-item rule below can handle those precisely.
    s = s.replace(/(\S)\*{2,}(?=[^\s\d])/g, "$1\n\n**");

    // Horizontal rule glued to the next block: ---**Header:**
    s = s.replace(/(-{3,})(\*\*)/g, "$1\n\n$2");

    // Bold headers glued directly after a sentence end. Colon may sit
    // inside the bold ("**Label:**") or outside ("**Label**:"). Inner
    // content must contain a letter, and the punctuation must not be a
    // list marker dot ("1. **Item**"), so bare list markers survive.
    s = s.replace(
        /(?<![0-9])([.!?"”'])[ \t]*(\*\*(?=[^*\n]*[A-Za-z])[^*\n]{2,120}:?\*\*:?)/g,
        "$1\n\n$2"
    );

    // Numbered list items glued right after a bold close / quote close:
    //   ..."quote one"**2. "quote two"   |   **"q"**2. **"q2"
    // Zero-gap only — well-formed lists have a newline here instead.
    // Lookahead keeps decimals ("cost 3.5 dollars") untouched.
    s = s.replace(
        /(\*\*|[”"])(\d{1,2}\.\s+(?=\*\*|“|"|[A-Z]))/g,
        "$1\n$2"
    );

    return s;
}
