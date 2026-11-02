#!/usr/bin/env node
// Stage the native runtime libraries the packaged app needs.
//
// Windows: sherpa-onnx + ONNX Runtime DLLs and the Visual C++ runtime,
// deployed app-local next to prmptr.exe.
// Linux: the shared sherpa-onnx/ONNX Runtime libraries, bundled into the
// package at /usr/lib/PRMPTR and found through the executable RUNPATH
// ($ORIGIN/../lib/PRMPTR).
//
// Run by `beforeBuildCommand` (and `npm run tauri:build`). It builds
// sherpa-rs-sys first so its build script has downloaded the libraries even
// on a clean checkout.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tauriDir = join(root, "src-tauri");

/** Platform-only bundle resources; the base config already has models/templates. */
function writeBundleConfig(resources) {
    const path = join(tauriDir, "tauri.bundle.local.conf.json");
    writeFileSync(path, `${JSON.stringify({ bundle: { resources } }, null, 2)}\n`);
    console.log(`stage-native-libs: wrote ${path}`);
}

function buildSherpa() {
    execFileSync("cargo", ["build", "--release", "-p", "sherpa-rs-sys"], {
        cwd: tauriDir,
        stdio: "inherit",
    });
}

if (process.platform === "win32") {
    const profileDir = join(tauriDir, "target", "release");
    const outDir = join(tauriDir, "runtime-dlls");

    buildSherpa();

    const SHERPA = [
        "sherpa-onnx-c-api.dll",
        "sherpa-onnx-cxx-api.dll",
        "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
        "cargs.dll",
    ];
    const VC = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

    function vcRedistDir() {
        const vswhere = join(
            process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
            "Microsoft Visual Studio",
            "Installer",
            "vswhere.exe",
        );
        const install = execFileSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], {
            encoding: "utf8",
        }).trim();
        const redistRoot = join(install, "VC", "Redist", "MSVC");
        const versions = readdirSync(redistRoot)
            .filter((v) => /^\d/.test(v))
            .sort()
            .reverse();
        for (const version of versions) {
            const x64 = join(redistRoot, version, "x64");
            if (!existsSync(x64)) continue;
            const crt = readdirSync(x64).find((d) => /^Microsoft\.VC\d+\.CRT$/.test(d));
            if (crt) return join(x64, crt);
        }
        throw new Error(`No Microsoft.VC*.CRT redist folder under ${redistRoot}`);
    }

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const dll of SHERPA) {
        const src = join(profileDir, dll);
        if (!existsSync(src)) throw new Error(`missing ${src} — did sherpa-rs-sys download its binaries?`);
        copyFileSync(src, join(outDir, dll));
    }
    const crt = vcRedistDir();
    for (const dll of VC) copyFileSync(join(crt, dll), join(outDir, dll));
    writeBundleConfig(
        Object.fromEntries([...SHERPA, ...VC].map((dll) => [`runtime-dlls/${dll}`, dll])),
    );
    console.log(`stage-native-libs: staged ${SHERPA.length + VC.length} DLLs into ${outDir}`);
} else if (process.platform === "linux") {
    const outDir = join(tauriDir, "runtime-libs", "linux");
    const LIBS = ["libsherpa-onnx-c-api.so", "libsherpa-onnx-cxx-api.so", "libonnxruntime.so"];

    buildSherpa();

    /** Depth-first search for a file under a shallow cache tree. */
    function findFile(dir, name, depth = 0) {
        if (depth > 8) return null;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                const hit = findFile(path, name, depth + 1);
                if (hit) return hit;
            } else if (entry.name === name) {
                return path;
            }
        }
        return null;
    }

    const roots = [
        process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "sherpa-rs") : null,
        join(homedir(), ".local", "share", "sherpa-rs"),
    ].filter((path) => path && existsSync(path));

    let found = null;
    for (const base of roots) {
        found = findFile(base, "libsherpa-onnx-c-api.so");
        if (found) break;
    }
    if (!found) {
        throw new Error("sherpa-rs did not download its shared libraries; cannot bundle them");
    }

    const libDir = dirname(found);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const lib of LIBS) {
        const src = join(libDir, lib);
        if (!existsSync(src)) throw new Error(`missing ${src} — the sherpa archive changed its layout`);
        copyFileSync(src, join(outDir, lib));
    }
    writeBundleConfig(
        Object.fromEntries(LIBS.map((lib) => [`runtime-libs/linux/${lib}`, lib])),
    );
    console.log(`stage-native-libs: staged ${LIBS.length} shared libraries into ${outDir}`);
} else {
    writeBundleConfig({});
    console.log("stage-native-libs: no native libraries to stage for this platform");
}
