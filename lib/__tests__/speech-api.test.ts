import { describe, expect, it } from "vitest";
import { toNativeLocalSpeechConfig } from "../speech-api";

describe("neutral speech API", () => {
    it("represents Moonshine as an explicit engine id, not a Whisper boolean", () => {
        expect(
            toNativeLocalSpeechConfig({
                engine: "moonshine-sherpa",
                inputDeviceName: "Mic",
                muteOutput: true,
            })
        ).toEqual({
            input_device_name: "Mic",
            output_device_name: null,
            whisper_model_id: null,
            prefer_gpu: false,
            engine: "moonshine-sherpa",
            mute_input: false,
            mute_output: true,
            queue_capacity: 96,
        });
    });

    it("clamps bounded queue capacity to the supported range", () => {
        expect(toNativeLocalSpeechConfig({ engine: "whisper", queueCapacity: 1 }).queue_capacity).toBe(8);
        expect(toNativeLocalSpeechConfig({ engine: "whisper", queueCapacity: 10_000 }).queue_capacity).toBe(1024);
    });
});
