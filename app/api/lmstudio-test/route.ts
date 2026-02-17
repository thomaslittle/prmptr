import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url") || "http://localhost:1234";

    try {
        const resp = await fetch(`${url}/v1/models`, {
            signal: AbortSignal.timeout(5000),
        });

        if (resp.ok) {
            const data = await resp.json();
            return Response.json({ connected: true, models: data });
        }

        return Response.json(
            { connected: false, error: `LM Studio returned ${resp.status}` },
            { status: 502 }
        );
    } catch (err) {
        return Response.json(
            {
                connected: false,
                error: err instanceof Error ? err.message : "Cannot reach LM Studio",
            },
            { status: 502 }
        );
    }
}
