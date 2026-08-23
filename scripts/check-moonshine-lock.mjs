#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXPECTED_WRAPPER_REV = "887c89f641d9bf8469099aa1e1f21c65ed72d24d";

async function main() {
    const cargoToml = await readFile(resolve("src-tauri/Cargo.toml"), "utf8");
    const cargoLock = await readFile(resolve("src-tauri/Cargo.lock"), "utf8");
    const failures = [];

    if (!cargoToml.includes('moonshine-voice = ["dep:moonshine-rs", "dep:crc32c"]')) {
        failures.push("Cargo.toml moonshine-voice feature no longer has the expected dependency set");
    }
    if (!cargoToml.includes(`rev = "${EXPECTED_WRAPPER_REV}"`)) {
        failures.push(`Cargo.toml is not pinned to moonshine-rs ${EXPECTED_WRAPPER_REV}`);
    }
    if (!cargoLock.includes('name = "moonshine-rs"')) {
        failures.push("Cargo.lock does not contain moonshine-rs");
    }
    if (!cargoLock.includes('name = "moonshine-sys"')) {
        failures.push("Cargo.lock does not contain moonshine-sys");
    }
    if (!cargoLock.includes('name = "crc32c"')) {
        failures.push("Cargo.lock does not contain crc32c");
    }
    if (cargoLock.includes('name = "moonshine-rs"') && !cargoLock.includes(EXPECTED_WRAPPER_REV)) {
        failures.push(`Cargo.lock moonshine-rs source is not pinned to ${EXPECTED_WRAPPER_REV}`);
    }

    if (failures.length > 0) {
        console.error("Moonshine Voice lock qualification FAILED:");
        for (const failure of failures) console.error(`- ${failure}`);
        console.error("\nRegenerate src-tauri/Cargo.lock on a Rust-capable machine with the moonshine-voice feature, then rerun this guard.");
        process.exitCode = 2;
        return;
    }

    console.log(`Moonshine Voice lock qualification PASS (${EXPECTED_WRAPPER_REV})`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
});
