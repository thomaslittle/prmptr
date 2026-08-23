import type { FeedItem } from "./types";

export type TranscriptTrackId = "mic" | "system" | "unknown";
export type TranscriptRole = "you" | "them" | "unknown";

export interface TranscriptWord {
    text: string;
    startMs: number;
    endMs: number;
    confidence?: number;
}

export interface SpeakerSpan {
    speakerKey: string;
    speakerIndex: number;
    label?: string;
    startMs: number;
    endMs: number;
    startChar?: number;
    endChar?: number;
}

export interface TranscriptLine {
    id: string;
    revision: number;
    trackId: TranscriptTrackId;
    role: TranscriptRole;
    engine: string;
    model: string;
    modelVersion?: string;
    text: string;
    startMs: number;
    endMs: number;
    isComplete: boolean;
    words: TranscriptWord[];
    speakerSpans: SpeakerSpan[];
    latencyMs?: number;
    createdAt: string;
    updatedAt: string;
}

export interface LegacyLocalTranscriptionResult {
    id: string;
    text: string;
    is_final: boolean;
    timestamp: string;
    device_type: "input" | "output";
    speaker_id: number | null;
    speaker_label: string | null;
}

function cleanSpeakerLabel(value?: string): string | undefined {
    const cleaned = value
        ?.replace(/[\r\n\[\]]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 64);
    return cleaned || undefined;
}

function speakerKey(trackId: TranscriptTrackId, speakerIndex: number): string {
    return `${trackId}:${speakerIndex}`;
}

export function legacyLocalResultToTranscriptLine(
    result: LegacyLocalTranscriptionResult,
    previous?: TranscriptLine,
    engine = "local",
    model = "legacy-local"
): TranscriptLine {
    const trackId: TranscriptTrackId = result.device_type === "input" ? "mic" : "system";
    const role: TranscriptRole = trackId === "mic" ? "you" : "them";
    const label = cleanSpeakerLabel(result.speaker_label ?? undefined);
    const speakerSpans: SpeakerSpan[] =
        trackId === "system" && result.speaker_id != null
            ? [
                  {
                      speakerKey: speakerKey(trackId, result.speaker_id),
                      speakerIndex: result.speaker_id,
                      label: label ?? `Speaker ${result.speaker_id}`,
                      startMs: previous?.startMs ?? 0,
                      endMs: previous?.endMs ?? 0,
                      startChar: 0,
                      endChar: result.text.length,
                  },
              ]
            : [];

    return {
        id: result.id,
        revision: previous ? previous.revision + 1 : 0,
        trackId,
        role,
        engine,
        model,
        text: result.text,
        startMs: previous?.startMs ?? 0,
        endMs: previous?.endMs ?? 0,
        isComplete: result.is_final,
        words: previous?.words ?? [],
        speakerSpans,
        createdAt: previous?.createdAt ?? result.timestamp,
        updatedAt: result.timestamp,
    };
}

export function feedItemToTranscriptLine(item: FeedItem): TranscriptLine {
    const trackId: TranscriptTrackId =
        item.deviceType === "input" ? "mic" : item.deviceType === "output" ? "system" : "unknown";
    const role: TranscriptRole = trackId === "mic" ? "you" : trackId === "system" ? "them" : "unknown";
    const speakerIndex = item.speaker;
    const label = cleanSpeakerLabel(item.speakerLabel);
    const spans: SpeakerSpan[] =
        speakerIndex != null
            ? [
                  {
                      speakerKey: speakerKey(trackId, speakerIndex),
                      speakerIndex,
                      label: label ?? `Speaker ${speakerIndex}`,
                      startMs: 0,
                      endMs: 0,
                      startChar: 0,
                      endChar: item.content.length,
                  },
              ]
            : [];

    return {
        id: item.id,
        revision: 0,
        trackId,
        role,
        engine: item.source.toLowerCase().includes("deepgram") ? "deepgram" : "legacy",
        model: "unknown",
        text: item.content,
        startMs: 0,
        endMs: 0,
        isComplete: item.isFinal !== false,
        words: [],
        speakerSpans: spans,
        createdAt: item.timestamp,
        updatedAt: item.timestamp,
    };
}

export function upsertTranscriptLine(lines: TranscriptLine[], incoming: TranscriptLine): TranscriptLine[] {
    const index = lines.findIndex((line) => line.id === incoming.id);
    if (index < 0) {
        return [...lines, incoming];
    }

    const current = lines[index];
    if (incoming.revision < current.revision) {
        return lines;
    }
    if (
        incoming.revision === current.revision &&
        Date.parse(incoming.updatedAt) <= Date.parse(current.updatedAt)
    ) {
        return lines;
    }

    const next = [...lines];
    next[index] = incoming;
    return next;
}

export function reduceTranscriptLines(
    lines: TranscriptLine[],
    incoming: TranscriptLine | TranscriptLine[]
): TranscriptLine[] {
    return (Array.isArray(incoming) ? incoming : [incoming]).reduce(upsertTranscriptLine, lines);
}

function baseFeedItem(line: TranscriptLine, content: string, id: string): FeedItem {
    return {
        id,
        type: "audio",
        content,
        timestamp: line.createdAt,
        source: `${line.engine}${line.model ? ` / ${line.model}` : ""}`,
        deviceType: line.trackId === "mic" ? "input" : line.trackId === "system" ? "output" : undefined,
        isFinal: line.isComplete,
    };
}

function validCharSpans(line: TranscriptLine): Array<SpeakerSpan & { startChar: number; endChar: number }> {
    return line.speakerSpans
        .filter(
            (span): span is SpeakerSpan & { startChar: number; endChar: number } =>
                Number.isInteger(span.startChar) &&
                Number.isInteger(span.endChar) &&
                (span.startChar ?? -1) >= 0 &&
                (span.endChar ?? -1) > (span.startChar ?? -1) &&
                (span.endChar ?? Infinity) <= line.text.length
        )
        .sort((a, b) => a.startChar - b.startChar || a.endChar - b.endChar);
}

export function transcriptLineToFeedItems(line: TranscriptLine): FeedItem[] {
    const spans = validCharSpans(line);
    if (spans.length === 0) {
        const item = baseFeedItem(line, line.text, line.id);
        const firstSpeaker = line.trackId === "system" ? line.speakerSpans[0] : undefined;
        if (firstSpeaker) {
            item.speaker = firstSpeaker.speakerIndex;
            item.speakerLabel = cleanSpeakerLabel(firstSpeaker.label) ?? `Speaker ${firstSpeaker.speakerIndex}`;
        }
        return [item];
    }

    const items: FeedItem[] = [];
    let cursor = 0;
    let segmentIndex = 0;

    const pushGap = (from: number, to: number) => {
        const content = line.text.slice(from, to).trim();
        if (!content) return;
        items.push(baseFeedItem(line, content, `${line.id}:gap:${segmentIndex++}:${from}-${to}`));
    };

    for (const span of spans) {
        if (span.startChar > cursor) {
            pushGap(cursor, span.startChar);
        }

        const from = Math.max(cursor, span.startChar);
        const to = Math.max(from, span.endChar);
        const content = line.text.slice(from, to).trim();
        if (content) {
            const item = baseFeedItem(
                line,
                content,
                `${line.id}:speaker:${span.speakerKey}:${from}-${to}`
            );
            if (line.trackId === "system") {
                item.speaker = span.speakerIndex;
                item.speakerLabel = cleanSpeakerLabel(span.label) ?? `Speaker ${span.speakerIndex}`;
            }
            items.push(item);
            segmentIndex += 1;
        }
        cursor = Math.max(cursor, span.endChar);
    }

    if (cursor < line.text.length) {
        pushGap(cursor, line.text.length);
    }

    return items.length > 0 ? items : [baseFeedItem(line, line.text, line.id)];
}

export function transcriptLinesToFeedItems(lines: TranscriptLine[]): FeedItem[] {
    return [...lines]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .flatMap(transcriptLineToFeedItems);
}
