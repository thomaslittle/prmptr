// Serves the production static export (`out/`) the way Tauri's asset
// protocol does: exact file, then `<path>.html`, then `<path>/index.html`.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "out");
const port = Number(process.argv[3] ?? 43120);
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (rel.startsWith("..")) {
        res.writeHead(403).end();
        return;
    }
    const base = join(root, rel);
    const candidates = [base, `${base}.html`, join(base, "index.html")];
    for (const file of candidates) {
        if (await isFile(file)) {
            res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
            res.end(await readFile(file));
            return;
        }
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end(await readFile(join(root, "404.html")).catch(() => "not found"));
}).listen(port, "127.0.0.1", () => console.log(`static server on http://127.0.0.1:${port}`));
