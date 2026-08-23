import { spawn } from "node:child_process";

/**
 * Enumerate the local OpenCode model catalog via the installed `opencode`
 * CLI (`opencode models --verbose`) — the authoritative local source. This
 * never requires a Zen API key: models are read straight from the locally
 * configured OpenCode instance, exactly how the CLI itself lists them (and
 * mirroring t3code's parser).
 *
 * Output shape (newline-delimited) is a series of blocks:
 *
 *   provider/model-id
 *   { ...model json... }
 *
 * We walk the blocks and keep the display `name` (which OpenCode supplies,
 * e.g. "Ox Alpha Free (Unlimited)") plus optional image-support.
 */

export interface OpencodeCliModel {
    /** Model slug, e.g. `x-preview-f-free`. */
    slug: string;
    /** Provider-supplied display name. */
    name: string;
    /** Provider prefix from the slug, e.g. `opencode`. */
    provider: string;
    supportsImageInput?: boolean;
}

const SLUG_LINE_RE = /^(\S+\/\S+)\s*$/;

function parseModelsCliOutput(stdout: string): OpencodeCliModel[] {
    const models: OpencodeCliModel[] = [];
    let currentSlug: string | null = null;
    let jsonLines: string[] = [];

    const flush = () => {
        if (currentSlug !== null && jsonLines.length > 0) {
            const jsonStr = jsonLines.join("\n").trim();
            if (jsonStr.length > 0) {
                try {
                    const parsed = JSON.parse(jsonStr) as {
                        name?: unknown;
                        providerID?: unknown;
                        capabilities?: { input?: { image?: unknown } };
                    };
                    const separator = currentSlug.indexOf("/");
                    if (separator > 0) {
                        const provider = currentSlug.slice(0, separator);
                        const slug = currentSlug.slice(separator + 1);
                        const name = typeof parsed.name === "string" ? parsed.name : slug;
                        const image = parsed.capabilities?.input?.image;
                        const supportsImageInput =
                            typeof image === "boolean" ? image : undefined;
                        models.push({
                            slug,
                            name,
                            provider,
                            ...(supportsImageInput !== undefined
                                ? { supportsImageInput }
                                : {}),
                        });
                    }
                } catch {
                    // Skip unparseable model block.
                }
            }
        }
        currentSlug = null;
        jsonLines = [];
    };

    for (const line of stdout.split(/\r?\n/)) {
        // A model's JSON body begins with `{`; only treat bare `provider/model`
        // lines as slug headers (mirrors t3code's guard so a body line with a
        // `/` in a value isn't misread as a slug).
        const slugMatch = line.trimStart().startsWith("{") ? null : SLUG_LINE_RE.exec(line);
        if (slugMatch) {
            flush();
            currentSlug = slugMatch[1];
        } else if (currentSlug !== null) {
            jsonLines.push(line);
        }
    }
    flush();

    return models;
}

/**
 * Fetch the live OpenCode model catalog. Resolves to `[]` (never throws) when
 * the OpenCode CLI isn't installed or can't run, so callers fall back cleanly.
 */
export async function fetchOpencodeCliModels(): Promise<OpencodeCliModel[]> {
    return await new Promise((resolve) => {
        const child = spawn("opencode", ["models", "--verbose"], {
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
        });

        let stdout = "";
        const timeout = setTimeout(() => {
            try {
                child.kill();
            } catch {}
        }, 20_000);

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });

        child.on("error", () => {
            clearTimeout(timeout);
            resolve([]);
        });

        child.on("close", () => {
            clearTimeout(timeout);
            if (!stdout.trim()) {
                resolve([]);
                return;
            }
            resolve(parseModelsCliOutput(stdout));
        });
    });
}
