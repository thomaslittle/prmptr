import { NextRequest, NextResponse } from "next/server";
import { ScreenpipeClient } from "@/lib/screenpipe-client";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const screenpipeUrl =
        searchParams.get("screenpipeUrl") || "http://localhost:3030";

    const client = new ScreenpipeClient(screenpipeUrl);
    const health = await client.checkHealth();

    return NextResponse.json(health);
}
