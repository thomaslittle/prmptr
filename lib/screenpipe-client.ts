import { ScreenpipeQuery, ScreenpipeResponse, FeedItem } from "./types";

const DEFAULT_SCREENPIPE_URL = "http://localhost:3030";

export class ScreenpipeClient {
    private baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = (baseUrl || DEFAULT_SCREENPIPE_URL).replace(/\/$/, "");
    }

    async queryScreenpipe(
        params: ScreenpipeQuery
    ): Promise<ScreenpipeResponse | null> {
        try {
            const searchParams = new URLSearchParams();

            if (params.q) searchParams.set("q", params.q);
            if (params.contentType)
                searchParams.set("content_type", params.contentType);
            if (params.limit) searchParams.set("limit", String(params.limit));
            if (params.offset) searchParams.set("offset", String(params.offset));
            if (params.startTime) searchParams.set("start_time", params.startTime);
            if (params.endTime) searchParams.set("end_time", params.endTime);
            if (params.appName) searchParams.set("app_name", params.appName);
            if (params.windowName)
                searchParams.set("window_name", params.windowName);
            if (params.includeFrames)
                searchParams.set("include_frames", String(params.includeFrames));
            if (params.minLength)
                searchParams.set("min_length", String(params.minLength));
            if (params.maxLength)
                searchParams.set("max_length", String(params.maxLength));
            if (params.speakerName)
                searchParams.set("speaker_name", params.speakerName);
            if (params.browserUrl)
                searchParams.set("browser_url", params.browserUrl);

            const url = `${this.baseUrl}/search?${searchParams.toString()}`;
            const response = await fetch(url, {
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                throw new Error(`Screenpipe API error: ${response.status}`);
            }

            return (await response.json()) as ScreenpipeResponse;
        } catch (error) {
            console.error("Screenpipe query failed:", error);
            return null;
        }
    }

    async getRecentContent(
        since: Date,
        contentType: "ocr" | "audio" | "all" = "all",
        limit: number = 50
    ): Promise<ScreenpipeResponse | null> {
        return this.queryScreenpipe({
            startTime: since.toISOString(),
            endTime: new Date().toISOString(),
            contentType,
            limit,
        });
    }

    async checkHealth(): Promise<{
        connected: boolean;
        message: string;
        version?: string;
    }> {
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                const data = await response.json().catch(() => null);
                return {
                    connected: true,
                    message: "Connected",
                    version: data?.version,
                };
            }

            return {
                connected: false,
                message: `Server returned status ${response.status}`,
            };
        } catch (error) {
            return {
                connected: false,
                message:
                    error instanceof Error
                        ? `Connection failed: ${error.message}`
                        : "Connection failed",
            };
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static toFeedItems(response: ScreenpipeResponse): FeedItem[] {
        if (!response?.data) return [];

        return response.data
            .map((item, index) => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const c = item.content as any;

                    if (item.type === "OCR") {
                        const text = c.text ?? "";
                        if (!text.trim()) return null;

                        return {
                            id: `ocr-${c.timestamp || Date.now()}-${index}`,
                            type: "ocr" as const,
                            content: text,
                            timestamp: c.timestamp || new Date().toISOString(),
                            source: c.app_name || c.appName || "Unknown",
                            windowName: c.window_name || c.windowName || undefined,
                        };
                    } else {
                        const transcription = c.transcription ?? "";
                        if (!transcription.trim()) return null;

                        const deviceName = c.device_name || c.deviceName || "Microphone";
                        const deviceType = c.device_type || c.deviceType;
                        let resolvedDeviceType: "input" | "output" | undefined;
                        if (deviceType === "input" || deviceName.includes("(input)")) resolvedDeviceType = "input";
                        else if (deviceType === "output" || deviceName.includes("(output)")) resolvedDeviceType = "output";

                        return {
                            id: `audio-${c.timestamp || Date.now()}-${index}`,
                            type: "audio" as const,
                            content: transcription,
                            timestamp: c.timestamp || new Date().toISOString(),
                            source: deviceName,
                            speaker: c.speaker?.id ?? c.speaker_id,
                            deviceType: resolvedDeviceType,
                        };
                    }
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as FeedItem[];
    }
}
