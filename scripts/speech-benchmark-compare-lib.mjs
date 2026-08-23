const DEFAULT_LIMITS = Object.freeze({
    maxWerRegression: 0.01,
    maxCerRegression: 0.01,
    maxTechnicalTermRegression: 0.02,
    maxSpeakerConfusionRegression: 0.02,
    maxDuplicateRegression: 0.02,
    maxLatencyP95RegressionMs: 75,
    maxInferenceP95RegressionMs: 75,
    maxDroppedSamples: 0,
});

function finite(value) {
    return Number.isFinite(value) ? value : null;
}

function regression(candidate, baseline) {
    const c = finite(candidate);
    const b = finite(baseline);
    if (c == null || b == null) return null;
    return c - b;
}

function checkDelta(failures, label, delta, limit, unit = "") {
    if (delta != null && delta > limit) {
        failures.push(`${label} regression ${delta.toFixed(4)}${unit} > ${limit}${unit}`);
    }
}

export function compareBenchmarkResults(baseline, candidate, overrides = {}) {
    if (!baseline?.metrics || !candidate?.metrics) {
        throw new Error("Both benchmark results must contain a metrics object");
    }

    const limits = { ...DEFAULT_LIMITS, ...overrides };
    const deltas = {
        wer: regression(candidate.metrics.wer, baseline.metrics.wer),
        cer: regression(candidate.metrics.cer, baseline.metrics.cer),
        technicalTermErrorRate: regression(
            candidate.metrics.technicalTermErrorRate,
            baseline.metrics.technicalTermErrorRate
        ),
        speakerWordConfusionRate: regression(
            candidate.metrics.speakerWordConfusionRate,
            baseline.metrics.speakerWordConfusionRate
        ),
        meanDuplicateCrossChannelRate: regression(
            candidate.metrics.meanDuplicateCrossChannelRate,
            baseline.metrics.meanDuplicateCrossChannelRate
        ),
        latencyP95Ms: regression(candidate.metrics.latencyP95Ms, baseline.metrics.latencyP95Ms),
        inferenceP95Ms: regression(
            candidate.metrics.inferenceP95Ms,
            baseline.metrics.inferenceP95Ms
        ),
    };

    const failures = [];
    checkDelta(failures, "WER", deltas.wer, limits.maxWerRegression);
    checkDelta(failures, "CER", deltas.cer, limits.maxCerRegression);
    checkDelta(
        failures,
        "technical-term error",
        deltas.technicalTermErrorRate,
        limits.maxTechnicalTermRegression
    );
    checkDelta(
        failures,
        "speaker confusion",
        deltas.speakerWordConfusionRate,
        limits.maxSpeakerConfusionRegression
    );
    checkDelta(
        failures,
        "duplicate cross-channel rate",
        deltas.meanDuplicateCrossChannelRate,
        limits.maxDuplicateRegression
    );
    checkDelta(
        failures,
        "latency p95",
        deltas.latencyP95Ms,
        limits.maxLatencyP95RegressionMs,
        "ms"
    );
    checkDelta(
        failures,
        "inference p95",
        deltas.inferenceP95Ms,
        limits.maxInferenceP95RegressionMs,
        "ms"
    );

    const dropped = finite(candidate.metrics.droppedSamples) ?? 0;
    if (dropped > limits.maxDroppedSamples) {
        failures.push(`dropped samples ${dropped} > ${limits.maxDroppedSamples}`);
    }

    return {
        schemaVersion: 1,
        baselineSuite: baseline.suite ?? "unnamed",
        candidateSuite: candidate.suite ?? "unnamed",
        baselineEngine: baseline.engine ?? {},
        candidateEngine: candidate.engine ?? {},
        limits,
        deltas,
        passed: failures.length === 0,
        failures,
    };
}

export function formatComparisonSummary(result) {
    const pct = (value) => (value == null ? "n/a" : `${(value * 100).toFixed(2)} pp`);
    const ms = (value) => (value == null ? "n/a" : `${Math.round(value)} ms`);
    return [
        `PRMPTR speech regression gate: ${result.passed ? "PASS" : "FAIL"}`,
        `Baseline: ${result.baselineSuite}`,
        `Candidate: ${result.candidateSuite}`,
        `WER delta: ${pct(result.deltas.wer)}`,
        `CER delta: ${pct(result.deltas.cer)}`,
        `Technical-term delta: ${pct(result.deltas.technicalTermErrorRate)}`,
        `Speaker-confusion delta: ${pct(result.deltas.speakerWordConfusionRate)}`,
        `Duplicate-channel delta: ${pct(result.deltas.meanDuplicateCrossChannelRate)}`,
        `Latency p95 delta: ${ms(result.deltas.latencyP95Ms)}`,
        `Inference p95 delta: ${ms(result.deltas.inferenceP95Ms)}`,
        ...(result.failures.length ? result.failures.map((failure) => `FAIL: ${failure}`) : []),
    ].join("\n");
}

export { DEFAULT_LIMITS };
