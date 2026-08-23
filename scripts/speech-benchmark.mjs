#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateManifest, formatHumanSummary } from "./speech-benchmark-lib.mjs";

function parseArgs(argv) {
    const options = {
        manifest: "benchmarks/speech/fixtures/smoke-manifest.json",
        output: null,
        maxWer: null,
        maxSpeakerConfusion: null,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === "--manifest" && next) {
            options.manifest = next;
            i += 1;
        } else if (arg === "--output" && next) {
            options.output = next;
            i += 1;
        } else if (arg === "--max-wer" && next) {
            options.maxWer = Number(next);
            i += 1;
        } else if (arg === "--max-speaker-confusion" && next) {
            options.maxSpeakerConfusion = Number(next);
            i += 1;
        } else if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    return options;
}

function usage() {
    return `Usage: npm run speech:benchmark -- [options]\n\nOptions:\n  --manifest <path>                 Benchmark manifest JSON\n  --output <path>                   Write machine-readable result JSON\n  --max-wer <ratio>                 Exit non-zero when aggregate WER exceeds ratio\n  --max-speaker-confusion <ratio>   Exit non-zero when comparable speaker-word confusion exceeds ratio\n  -h, --help                        Show this help\n`;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }

    const manifestPath = resolve(process.cwd(), options.manifest);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.cases)) {
        throw new Error("Benchmark manifest must contain a cases array");
    }

    const result = evaluateManifest(manifest);
    console.log(formatHumanSummary(result));

    if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
        console.log(`Result JSON: ${outputPath}`);
    }

    const failures = [];
    if (options.maxWer != null && result.metrics.wer > options.maxWer) {
        failures.push(`WER ${result.metrics.wer.toFixed(4)} > ${options.maxWer}`);
    }
    if (
        options.maxSpeakerConfusion != null &&
        result.metrics.speakerWordConfusionRate != null &&
        result.metrics.speakerWordConfusionRate > options.maxSpeakerConfusion
    ) {
        failures.push(
            `speaker confusion ${result.metrics.speakerWordConfusionRate.toFixed(4)} > ${options.maxSpeakerConfusion}`
        );
    }
    if (failures.length > 0) {
        console.error(`Benchmark gate failed: ${failures.join("; ")}`);
        process.exitCode = 2;
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
});
