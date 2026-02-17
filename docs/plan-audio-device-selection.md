# Plan: Audio Device Selection for Screenpipe

## Problem
Screenpipe starts with no `--audio-device` flag, so it either picks a random default or fails to capture audio. The app has no UI to select which audio source to monitor.

## Approach
The Rust backend already has full support: `ScreenpipeConfig.audio_device`, `to_args()` generates the `--audio-device` flag, and `get_audio_devices` command fetches available devices from screenpipe's `/audio/list` API.

The gap is entirely on the frontend — no UI, no persistence, and `startScreenpipe()` is called without passing any config.

Since device listing requires screenpipe to be running, the flow is:
1. Start screenpipe (uses system default device)
2. Once connected, auto-fetch available devices
3. User selects desired device from dropdown
4. Selection persists across sessions
5. On next Start, the selected device is passed as config

## Changes

### 1. `src-tauri/src/screenpipe/config.rs`
- Add `#[serde(default)]` to `ScreenpipeConfig` struct so the frontend can pass a partial config (just `audio_device`) and all other fields get sensible defaults

### 2. `lib/types.ts`
- Add `audioDevice?: string` to `AppSettings` interface

### 3. `lib/tauri.ts`
- Fix `getAudioDevices()` return type: `{ name: string; is_default: boolean }[]` (matches the Rust `AudioDevice` struct, currently has wrong `device_type` field)

### 4. `components/settings-panel.tsx`
- Add state for fetched audio devices list
- When `connectionStatus === "connected"`, auto-fetch devices via `getAudioDevices()`
- Show a `<Select>` dropdown below the Start/Stop button with the device list
- Default selection: device marked `is_default`, or the persisted `settings.audioDevice`
- On selection change, persist to `settings.audioDevice` via `onChange`
- When clicking Start, pass `{ audio_device: settings.audioDevice }` to `startScreenpipe()`
- Show hint text: "Select audio source (requires restart)"
