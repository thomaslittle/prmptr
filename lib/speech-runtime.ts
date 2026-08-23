import type {
    SpeakerSpan,
    TranscriptLine,
    TranscriptRole,
    TranscriptTrackId,
    TranscriptWord,
} from "@/lib/transcript";
import { isTauri } from "@/lib/tauri";

export interface NativeTranscriptWord {
    text: string;
    start_ms: number;
    end_ms: number;
    confidence?: number | null;
}

export interface NativeSpeakerSpan {
    speaker_key: string;
    speaker_index: number;
    label?: string | null;
    start_ms: number;
    end_ms: number;
    start_char?: number | null;
    end_char?: number | null;
}

export interface NativeTranscriptLine {
    id: string;
    revision: number;
    track_id: TranscriptTrackId;
    role: TranscriptRole;
    engine: string;
    model: string;
    model_version?: string | null;
    text: string;
    start_ms: number;
    end_ms: number;
    is_complete: boolean;
    words?: NativeTranscriptWord[];
    speaker_spans?: NativeSpeakerSpan[];
    latency_ms?: number | null;
    created_at: string;
    updated_at: string;
}

function mapWord(word: NativeTranscriptWord): TranscriptWord {
    return {
        text: word.text,
        startMs: word.start_ms,
        endMs: word.end_ms,
        confidence: word.confidence ?? undefined,
    };
}

function mapSpeakerSpan(span: NativeSpeakerSpan): SpeakerSpan {
    return {
        speakerKey: span.speaker_key,
        speakerIndex: span.speaker_index,
        label: span.label ?? undefined,
        startMs: span.start_ms,
        endMs: span.end_ms,
        startChar: span.start_char ?? undefined,
        endChar: span.end_char ?? undefined,
    };
}

/** Convert the Rust canonical IPC contract to the frontend canonical shape. */
export function nativeTranscriptLineToTranscriptLine(
    line: NativeTranscriptLine
): TranscriptLine {
    return {
        id: line.id,
        revision: line.revision,
        trackId: line.track_id,
        role: line.role,
        engine: line.engine,
        model: line.model,
        modelVersion: line.model_version ?? undefined,
        text: line.text,
        startMs: line.start_ms,
        endMs: line.end_ms,
        isComplete: line.is_complete,
        words: (line.words ?? []).map(mapWord),
        speakerSpans: (line.speaker_spans ?? []).map(mapSpeakerSpan),
        latencyMs: line.latency_ms ?? undefined,
        createdAt: line.created_at,
        updatedAt: line.updated_at,
    };
}

export async function onSpeechTranscriptLine(
    callback: (line: NativeTranscriptLine) => void
): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<NativeTranscriptLine>("speech-transcript-line", (event) => {
        callback(event.payload);
    });
}
