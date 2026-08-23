export function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function tokenizeWords(value) {
    const normalized = normalizeText(value);
    return normalized ? normalized.split(" ") : [];
}

export function levenshteinDistance(left, right) {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
    for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const substitution = left[i - 1] === right[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + substitution
            );
        }
    }
    return matrix[left.length][right.length];
}

function alignTokens(reference, hypothesis) {
    const rows = reference.length + 1;
    const cols = hypothesis.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
    for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const substitution = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + substitution
            );
        }
    }

    const pairs = [];
    let i = reference.length;
    let j = hypothesis.length;
    while (i > 0 || j > 0) {
        if (
            i > 0 &&
            j > 0 &&
            matrix[i][j] ===
                matrix[i - 1][j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1)
        ) {
            pairs.push({ referenceIndex: i - 1, hypothesisIndex: j - 1 });
            i -= 1;
            j -= 1;
        } else if (i > 0 && matrix[i][j] === matrix[i - 1][j] + 1) {
            pairs.push({ referenceIndex: i - 1, hypothesisIndex: null });
            i -= 1;
        } else {
            pairs.push({ referenceIndex: null, hypothesisIndex: j - 1 });
            j -= 1;
        }
    }
    return pairs.reverse();
}

function flattenSpeakerWords(segments = []) {
    const out = [];
    for (const segment of segments) {
        for (const word of tokenizeWords(segment.text)) {
            out.push({ word, speaker: String(segment.speaker ?? "unknown") });
        }
    }
    return out;
}

function percentile(values, pct) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
    return sorted[index];
}

function mean(values) {
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function termStats(terms = [], hypothesis = "") {
    const normalizedHypothesis = ` ${normalizeText(hypothesis)} `;
    let hits = 0;
    for (const term of terms) {
        const normalizedTerm = normalizeText(term);
        if (normalizedTerm && normalizedHypothesis.includes(` ${normalizedTerm} `)) hits += 1;
    }
    return {
        total: terms.length,
        hits,
        misses: terms.length - hits,
    };
}

function speakerStats(referenceSegments = [], hypothesisSegments = []) {
    const reference = flattenSpeakerWords(referenceSegments);
    const hypothesis = flattenSpeakerWords(hypothesisSegments);
    if (reference.length === 0 || hypothesis.length === 0) {
        return { comparableWords: 0, confusedWords: 0 };
    }

    const pairs = alignTokens(
        reference.map((entry) => entry.word),
        hypothesis.map((entry) => entry.word)
    );
    let comparableWords = 0;
    let confusedWords = 0;
    for (const pair of pairs) {
        if (pair.referenceIndex == null || pair.hypothesisIndex == null) continue;
        const ref = reference[pair.referenceIndex];
        const hyp = hypothesis[pair.hypothesisIndex];
        if (ref.word !== hyp.word) continue;
        comparableWords += 1;
        if (ref.speaker !== hyp.speaker) confusedWords += 1;
    }
    return { comparableWords, confusedWords };
}

export function evaluateCase(testCase) {
    const referenceWords = tokenizeWords(testCase.reference);
    const hypothesisWords = tokenizeWords(testCase.hypothesis);
    const referenceChars = [...normalizeText(testCase.reference).replace(/\s/g, "")];
    const hypothesisChars = [...normalizeText(testCase.hypothesis).replace(/\s/g, "")];
    const wordEdits = levenshteinDistance(referenceWords, hypothesisWords);
    const charEdits = levenshteinDistance(referenceChars, hypothesisChars);
    const terms = termStats(testCase.terms, testCase.hypothesis);
    const speakers = speakerStats(testCase.referenceSpeakers, testCase.hypothesisSpeakers);

    return {
        id: testCase.id,
        category: testCase.category ?? "uncategorized",
        wordEdits,
        referenceWordCount: referenceWords.length,
        wer: referenceWords.length === 0 ? 0 : wordEdits / referenceWords.length,
        charEdits,
        referenceCharCount: referenceChars.length,
        cer: referenceChars.length === 0 ? 0 : charEdits / referenceChars.length,
        termHits: terms.hits,
        termMisses: terms.misses,
        termCount: terms.total,
        firstWordClipped:
            referenceWords.length > 0 &&
            (hypothesisWords.length === 0 || referenceWords[0] !== hypothesisWords[0]),
        lastWordClipped:
            referenceWords.length > 0 &&
            (hypothesisWords.length === 0 || referenceWords.at(-1) !== hypothesisWords.at(-1)),
        comparableSpeakerWords: speakers.comparableWords,
        speakerConfusedWords: speakers.confusedWords,
        latencyMs: Number.isFinite(testCase.latencyMs) ? testCase.latencyMs : null,
        inferenceMs: Number.isFinite(testCase.inferenceMs) ? testCase.inferenceMs : null,
        realTimeFactor: Number.isFinite(testCase.realTimeFactor) ? testCase.realTimeFactor : null,
        duplicateCrossChannelRate: Number.isFinite(testCase.duplicateCrossChannelRate)
            ? testCase.duplicateCrossChannelRate
            : null,
        droppedSamples: Number.isFinite(testCase.droppedSamples) ? testCase.droppedSamples : null,
    };
}

export function evaluateManifest(manifest) {
    const cases = (manifest.cases ?? []).map(evaluateCase);
    const totals = cases.reduce(
        (acc, item) => {
            acc.wordEdits += item.wordEdits;
            acc.referenceWordCount += item.referenceWordCount;
            acc.charEdits += item.charEdits;
            acc.referenceCharCount += item.referenceCharCount;
            acc.termHits += item.termHits;
            acc.termMisses += item.termMisses;
            acc.termCount += item.termCount;
            acc.firstWordClipped += item.firstWordClipped ? 1 : 0;
            acc.lastWordClipped += item.lastWordClipped ? 1 : 0;
            acc.comparableSpeakerWords += item.comparableSpeakerWords;
            acc.speakerConfusedWords += item.speakerConfusedWords;
            return acc;
        },
        {
            wordEdits: 0,
            referenceWordCount: 0,
            charEdits: 0,
            referenceCharCount: 0,
            termHits: 0,
            termMisses: 0,
            termCount: 0,
            firstWordClipped: 0,
            lastWordClipped: 0,
            comparableSpeakerWords: 0,
            speakerConfusedWords: 0,
        }
    );

    const latencyValues = cases.map((item) => item.latencyMs).filter(Number.isFinite);
    const inferenceValues = cases.map((item) => item.inferenceMs).filter(Number.isFinite);
    const rtfValues = cases.map((item) => item.realTimeFactor).filter(Number.isFinite);
    const duplicateValues = cases
        .map((item) => item.duplicateCrossChannelRate)
        .filter(Number.isFinite);
    const droppedValues = cases.map((item) => item.droppedSamples).filter(Number.isFinite);

    return {
        schemaVersion: 1,
        suite: manifest.suite ?? "unnamed",
        generatedAt: new Date().toISOString(),
        engine: manifest.engine ?? {},
        corpus: manifest.corpus ?? {},
        caseCount: cases.length,
        metrics: {
            wer: totals.referenceWordCount === 0 ? 0 : totals.wordEdits / totals.referenceWordCount,
            cer: totals.referenceCharCount === 0 ? 0 : totals.charEdits / totals.referenceCharCount,
            technicalTermErrorRate:
                totals.termCount === 0 ? null : totals.termMisses / totals.termCount,
            firstWordClippingRate:
                cases.length === 0 ? 0 : totals.firstWordClipped / cases.length,
            lastWordClippingRate:
                cases.length === 0 ? 0 : totals.lastWordClipped / cases.length,
            speakerWordConfusionRate:
                totals.comparableSpeakerWords === 0
                    ? null
                    : totals.speakerConfusedWords / totals.comparableSpeakerWords,
            latencyP50Ms: percentile(latencyValues, 50),
            latencyP95Ms: percentile(latencyValues, 95),
            inferenceP50Ms: percentile(inferenceValues, 50),
            inferenceP95Ms: percentile(inferenceValues, 95),
            meanRealTimeFactor: mean(rtfValues),
            meanDuplicateCrossChannelRate: mean(duplicateValues),
            droppedSamples: droppedValues.reduce((sum, value) => sum + value, 0),
        },
        totals,
        cases,
    };
}

export function formatHumanSummary(result) {
    const pct = (value) => (value == null ? "n/a" : `${(value * 100).toFixed(2)}%`);
    const ms = (value) => (value == null ? "n/a" : `${Math.round(value)} ms`);
    return [
        `PRMPTR speech benchmark: ${result.suite}`,
        `Cases: ${result.caseCount}`,
        `WER: ${pct(result.metrics.wer)}`,
        `CER: ${pct(result.metrics.cer)}`,
        `Technical-term error: ${pct(result.metrics.technicalTermErrorRate)}`,
        `Speaker word confusion: ${pct(result.metrics.speakerWordConfusionRate)}`,
        `First-word clipping: ${pct(result.metrics.firstWordClippingRate)}`,
        `Last-word clipping: ${pct(result.metrics.lastWordClippingRate)}`,
        `Latency p50/p95: ${ms(result.metrics.latencyP50Ms)} / ${ms(result.metrics.latencyP95Ms)}`,
        `Inference p50/p95: ${ms(result.metrics.inferenceP50Ms)} / ${ms(result.metrics.inferenceP95Ms)}`,
        `Mean realtime factor: ${result.metrics.meanRealTimeFactor == null ? "n/a" : result.metrics.meanRealTimeFactor.toFixed(3)}`,
        `Dropped samples: ${result.metrics.droppedSamples}`,
    ].join("\n");
}
