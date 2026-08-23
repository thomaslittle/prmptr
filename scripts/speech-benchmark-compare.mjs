#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    compareBenchmarkResults,
    formatComparisonSummary,
} from "./speech-benchmark-compare-lib.mjs";

function parseArgs(argv) {
    const options = { output: null, limits: {} };
    const numeric = {
        "--max-wer-regression": "maxWerRegression",
        "--max-cer-regression": "maxCerRegression",
        "--max-technical-term-regression": "maxTechnicalTermRegression",
        "--max-speaker-confusion-regression": "maxSpeakerConfusionRegression",
        "--max-duplicate-regression": "maxDuplicateRegression",
        "--max-latency-p95-regression-ms": "maxLatencyP95RegressionMs",
        "--max-inference-p95-regression-ms": "maxInferenceP95RegressionMs",
        "--max-dropped-samples": "maxDroppedSamples",
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--baseline" && next) {
            options.baseline = next;
            index += 1;
        } else if (arg === "--candidate" && next) {
            options.candidate = next;
            index += 1;
        } else if (arg === "--output" && next) {
            options.output = next;
            index += 1;
        } else if (numeric[arg] && next) {
            const value = Number(next);
            if (!Number.isFinite(value) || value < 0) {
                throw new Error(`${arg} requires a non-negative number`);
            }
            options.limits[numeric[arg]] = value;
            index += 1;
        } else if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    return options;
}

function usage() {
    return `Usage: npm run speech:benchmark:compare -- --baseline before.json --candidate after.json [options]\n\nThe gate fails on accuracy, diarization, duplicate-channel, latency, inference, or dropped-sample regressions. All limits are absolute deltas; 0.01 means one percentage point.\n`;
}

async function loadJson(path) {
    return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    if (!options.baseline || !options.candidate) {
        throw new Error("--baseline and --candidate are required");
    }

    const [baseline, candidate] = await Promise.all([
        loadJson(options.baseline),
        loadJson(options.candidate),
    ]);
    const result = compareBenchmarkResults(baseline, candidate, options.limits);
    console.log(formatComparisonSummary(result));

    if (options.output) {
        await writeFile(
            resolve(process.cwd(), options.output),
            `${JSON.stringify(result, null, 2)}\n`,
            "utf8"
        );
    }
    if (!result.passed) process.exitCode = 2;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
});
