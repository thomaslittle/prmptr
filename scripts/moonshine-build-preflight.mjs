#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WRAPPER_REVISION = "887c89f641d9bf8469099aa1e1f21c65ed72d24d";
const NATIVE_RELEASE = "v0.1.2";
const NATIVE_SOURCE_REVISION = "07648e45e0b1daf1923ce325cd61d624a407e615";

function fail(message) {
    console.error(`Moonshine qualification preflight: FAIL\n${message}`);
    process.exit(2);
}

const repoRoot = resolve(import.meta.dirname, "..");
const lockPath = resolve(repoRoot, "src-tauri", "Cargo.lock");
if (!existsSync(lockPath)) fail(`Missing ${lockPath}`);
const lock = readFileSync(lockPath, "utf8");
if (!lock.includes('name = "moonshine-rs"')) {
    fail("Cargo.lock does not contain moonshine-rs. Regenerate the lockfile on a Rust-capable machine first.");
}
if (!lock.includes(WRAPPER_REVISION)) {
    fail(`Cargo.lock does not pin moonshine-rs revision ${WRAPPER_REVISION}.`);
}
if (!lock.includes('name = "crc32c"')) {
    fail("Cargo.lock does not contain crc32c, required by the verified model installer.");
}

const moonshineDir = process.env.MOONSHINE_DIR?.trim();
if (!moonshineDir) {
    fail(
        "MOONSHINE_DIR is required for qualification builds. The upstream moonshine-sys fallback downloads native binaries during build without PRMPTR checksum verification; qualification intentionally forbids that path."
    );
}
const sourceDir = resolve(moonshineDir);
if (!existsSync(resolve(sourceDir, "core", "moonshine-c-api.h"))) {
    fail(`MOONSHINE_DIR does not look like a Moonshine source checkout: ${sourceDir}`);
}
let head;
try {
    head = execFileSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch (error) {
    fail(`Unable to resolve Moonshine source revision at ${sourceDir}: ${error}`);
}
if (head !== NATIVE_SOURCE_REVISION) {
    fail(
        `Moonshine source revision mismatch. Expected ${NATIVE_SOURCE_REVISION} (${NATIVE_RELEASE}), got ${head}.`
    );
}

if (process.env.MOONSHINE_VERSION && process.env.MOONSHINE_VERSION !== NATIVE_RELEASE) {
    fail(`MOONSHINE_VERSION must be ${NATIVE_RELEASE} when set.`);
}

console.log("Moonshine qualification preflight: PASS");
console.log(`wrapper=${WRAPPER_REVISION}`);
console.log(`native=${NATIVE_RELEASE}@${NATIVE_SOURCE_REVISION}`);
console.log(`MOONSHINE_DIR=${sourceDir}`);

if (process.argv.includes("--cargo-check")) {
    const result = spawnSync(
        "cargo",
        ["check", "--manifest-path", "src-tauri/Cargo.toml", "--features", "moonshine-voice", "--locked"],
        { cwd: repoRoot, stdio: "inherit", env: { ...process.env, MOONSHINE_DIR: sourceDir, MOONSHINE_VERSION: NATIVE_RELEASE } }
    );
    if (result.error) fail(`Unable to execute cargo: ${result.error.message}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
}
