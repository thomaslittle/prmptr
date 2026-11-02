#!/usr/bin/env node
// Stage the DLLs prmptr.exe needs at runtime into src-tauri/runtime-dlls/ so
// the installer ships them next to the exe (Windows only):
//   - sherpa-onnx + ONNX Runtime (speaker embeddings, local Kokoro TTS),
//     downloaded by sherpa-rs-sys's build script;
//   - the Visual C++ runtime, deployed app-local so the app starts on a PC
//     without the VC++ Redistributable (what all of the above link against).
// Run before `tauri build` (see `npm run tauri:build`); `tauri dev` loads the
// DLLs straight from target/debug and needs none of this.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "win32") {
    console.log("stage-native-dlls: not Windows, nothing to stage");
    process.exit(0);
}

const root = resolve(import.meta.dirname, "..");
const tauriDir = join(root, "src-tauri");
const profileDir = join(tauriDir, "target", "release");
const outDir = join(tauriDir, "runtime-dlls");

// Build sherpa-rs-sys first: its build script downloads the prebuilt DLLs
// into target/release. (Cargo doesn't order it before our own build script.)
execFileSync("cargo", ["build", "--release", "-p", "sherpa-rs-sys"], { cwd: tauriDir, stdio: "inherit" });

const SHERPA = ["sherpa-onnx-c-api.dll", "sherpa-onnx-cxx-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll", "cargs.dll"];
const VC = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

function vcRedistDir() {
    const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const install = execFileSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], { encoding: "utf8" }).trim();
    const redistRoot = join(install, "VC", "Redist", "MSVC");
    const versions = readdirSync(redistRoot).filter((v) => /^\d/.test(v)).sort().reverse();
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
console.log(`stage-native-dlls: staged ${SHERPA.length + VC.length} DLLs into ${outDir}`);
