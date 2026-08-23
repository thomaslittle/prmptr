import assert from "node:assert/strict";
import { compareBenchmarkResults } from "./speech-benchmark-compare-lib.mjs";

function result(overrides = {}) {
    return {
        suite: "fixture",
        engine: { id: "test" },
        metrics: {
            wer: 0.05,
            cer: 0.03,
            technicalTermErrorRate: 0.04,
            speakerWordConfusionRate: 0.03,
            meanDuplicateCrossChannelRate: 0.01,
            latencyP95Ms: 120,
            inferenceP95Ms: 90,
            droppedSamples: 0,
            ...overrides,
        },
    };
}

assert.equal(compareBenchmarkResults(result(), result()).passed, true);

const accuracyRegression = compareBenchmarkResults(result(), result({ wer: 0.08 }));
assert.equal(accuracyRegression.passed, false);
assert.ok(accuracyRegression.failures.some((failure) => failure.startsWith("WER regression")));

const timingRegression = compareBenchmarkResults(
    result(),
    result({ latencyP95Ms: 250, inferenceP95Ms: 200 })
);
assert.equal(timingRegression.passed, false);
assert.ok(timingRegression.failures.some((failure) => failure.startsWith("latency p95")));
assert.ok(timingRegression.failures.some((failure) => failure.startsWith("inference p95")));

const backpressureRegression = compareBenchmarkResults(result(), result({ droppedSamples: 1 }));
assert.equal(backpressureRegression.passed, false);
assert.ok(backpressureRegression.failures.some((failure) => failure.startsWith("dropped samples")));

const unavailableSpeakerMetric = compareBenchmarkResults(
    result({ speakerWordConfusionRate: null }),
    result({ speakerWordConfusionRate: null })
);
assert.equal(unavailableSpeakerMetric.passed, true);

console.log("speech-benchmark-compare tests: PASS");
