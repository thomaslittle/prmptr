import { NextRequest } from "next/server";
import WebSocket from "ws";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const screenpipeUrl =
        searchParams.get("screenpipeUrl") || "http://localhost:3030";

    const images = searchParams.get("images") ?? "false";

    const wsUrl = screenpipeUrl
        .replace(/^https:/, "wss:")
        .replace(/^http:/, "ws:");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            const sendEvent = (data: unknown) => {
                try {
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                    );
                } catch {
                    // Stream already closed
                }
            };

            const ws = new WebSocket(`${wsUrl}/ws/events?images=${images}`);

            ws.on("open", () => {
                sendEvent({ type: "status", connected: true, message: "Connected to realtime stream" });
            });

            ws.on("message", (raw) => {
                try {
                    const event = JSON.parse(raw.toString());

                    if (event.name === "transcription") {
                        const d = event.data;
                        const transcription = d.transcription ?? "";
                        if (!transcription.trim() || transcription.includes("[BLANK_AUDIO]")) return;

                        const deviceName: string = d.device || "Microphone";
                        let deviceType: "input" | "output" | undefined;
                        if (deviceName.includes("(input)")) deviceType = "input";
                        else if (deviceName.includes("(output)")) deviceType = "output";

                        sendEvent({
                            type: "feed",
                            item: {
                                id: `rt-${d.timestamp}-${d.speaker ?? 0}`,
                                type: "audio",
                                content: transcription,
                                timestamp: d.timestamp,
                                source: deviceName,
                                speaker: typeof d.speaker === "number" ? d.speaker : undefined,
                                deviceType,
                                isFinal: d.isFinal ?? true,
                            },
                        });
                    } else if (event.name === "ocr" || event.name === "ui") {
                        const d = event.data;
                        const text = (d.text ?? d.content ?? "").trim();
                        if (!text) return;

                        sendEvent({
                            type: "feed",
                            item: {
                                id: `ocr-${d.timestamp}-${(d.app_name || d.appName || "").slice(0, 10)}`,
                                type: "ocr",
                                content: text,
                                timestamp: d.timestamp,
                                source: d.app_name || d.appName || "Screen",
                                windowName: d.window_name || d.windowName,
                            },
                        });
                    }
                } catch (err) {
                    console.error("[stream] Error parsing WS message:", err);
                }
            });

            ws.on("error", (err) => {
                console.error("[stream] WebSocket error:", err.message);
                sendEvent({ type: "error", message: err.message });
            });

            ws.on("close", () => {
                sendEvent({ type: "status", connected: false, message: "Disconnected" });
                try { controller.close(); } catch { /* already closed */ }
            });

            request.signal.addEventListener("abort", () => {
                ws.close();
                try { controller.close(); } catch { /* already closed */ }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
