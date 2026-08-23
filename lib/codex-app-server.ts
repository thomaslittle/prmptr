import { spawn, type ChildProcess } from "node:child_process";
import { resolveCliCredential } from "./cli-providers-server";

/**
 * Minimal stdio JSON-RPC client for the Codex app-server, used to pull the
 * *live* ChatGPT model catalog (5.6-Sol/Terra/Luna, legacy 5.5/5.4, ...) —
 * never a hardcoded list. Mirrors t3code's `model/list` usage with a fraction
 * of the machinery: we only need initialize + model/list.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over the subprocess's stdio.
 */

export interface CodexLiveModel {
    /** Model slug, e.g. `gpt-5.6-sol`. */
    slug: string;
    /** Provider-supplied display name, e.g. `GPT-5.6-Sol`. */
    name: string;
    isDefault: boolean;
    hidden: boolean;
    supportsImageInput?: boolean;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
}

interface CodexRpcTransport {
    child: ChildProcess;
    nextId: number;
    pending: Map<number, PendingRequest>;
    buffer: string;
}

function spawnCodexAppServer(): CodexRpcTransport {
    const child = spawn("codex", ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
    });

    const transport: CodexRpcTransport = {
        child,
        nextId: 1,
        pending: new Map(),
        buffer: "",
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
        transport.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = transport.buffer.indexOf("\n")) !== -1) {
            const line = transport.buffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
            transport.buffer = transport.buffer.slice(newlineIndex + 1);
            if (line.length === 0) continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }
            if (parsed && typeof parsed === "object" && "id" in parsed) {
                const msg = parsed as { id: number; result?: unknown; error?: { message?: string } };
                const entry = transport.pending.get(msg.id);
                if (entry) {
                    transport.pending.delete(msg.id);
                    if (msg.error) {
                        entry.reject(new Error(msg.error.message ?? "Codex app-server error"));
                    } else {
                        entry.resolve(msg.result);
                    }
                }
            }
        }
    });

    return transport;
}

function rpcCall(transport: CodexRpcTransport, method: string, params?: unknown): Promise<unknown> {
    const id = transport.nextId++;
    return new Promise((resolve, reject) => {
        transport.pending.set(id, { resolve, reject });
        const line = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });
        transport.child.stdin?.write(line + "\n");
    });
}

function rpcNotify(transport: CodexRpcTransport, method: string, params?: unknown): void {
    const line = JSON.stringify({ method, ...(params !== undefined ? { params } : {}) });
    transport.child.stdin?.write(line + "\n");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the live ChatGPT model list from the installed Codex CLI. Resolves to
 * `[]` (never throws) when Codex isn't installed, isn't authenticated, or the
 * app-server can't be reached — so callers can fall back gracefully. Any
 * models returned are authoritative and come straight from the provider.
 */
export async function fetchCodexLiveModels(): Promise<CodexLiveModel[]> {
    let credential: Awaited<ReturnType<typeof resolveCliCredential>> = null;
    try {
        credential = await resolveCliCredential("codex-cli");
    } catch {
        credential = null;
    }
    if (!credential) return [];

    let transport: CodexRpcTransport | null = null;
    try {
        transport = spawnCodexAppServer();

        // Give the server a moment to be ready to read on stdin.
        await sleep(250);

        await rpcCall(transport, "initialize", {
            clientInfo: { name: "prmptr", version: "0.1.0" },
            capabilities: { experimentalApi: true },
        });

        // The app-server expects the `initialized` notification after a
        // successful handshake before client requests are served.
        rpcNotify(transport, "initialized");

        // Page through the entire catalog (the server defaults to a small
        // page and paginates via `nextCursor`).
        const models: CodexLiveModel[] = [];
        let cursor: string | null | undefined;
        do {
            const response = (await rpcCall(transport, "model/list", {
                ...(cursor ? { cursor } : {}),
                includeHidden: false,
            })) as { data?: unknown[]; nextCursor?: string | null };
            const data = Array.isArray(response?.data) ? response.data : [];
            for (const entry of data) {
                if (!entry || typeof entry !== "object") continue;
                const rec = entry as Record<string, unknown>;
                const slug = typeof rec.model === "string" ? rec.model : "";
                if (!slug) continue;
                const name =
                    typeof rec.displayName === "string" ? rec.displayName : slug;
                const inputModalities = Array.isArray(rec.inputModalities)
                    ? (rec.inputModalities as string[])
                    : [];
                const supportsImageInput =
                    inputModalities.length === 0 || inputModalities.includes("image");
                models.push({
                    slug,
                    name,
                    isDefault: rec.isDefault === true,
                    hidden: rec.hidden === true,
                    ...(inputModalities.length > 0 ? { supportsImageInput } : {}),
                });
            }
            cursor = typeof response?.nextCursor === "string" ? response.nextCursor : null;
        } while (cursor);

        return models;
    } catch {
        return [];
    } finally {
        if (transport) {
            try {
                transport.child.stdin?.end();
            } catch {}
            try {
                transport.child.kill();
            } catch {}
        }
    }
}
