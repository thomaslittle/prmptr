// SERVER-ONLY helpers for local AI CLI subscription integration.
//
// Detects installed/authenticated coding CLIs and resolves their stored
// subscription credentials at call time — the same well-known-config-file
// approach t3code uses (no CLI spawning required):
//
//   Claude Code : ~/.claude.json (account) + <CLAUDE_CONFIG_DIR|~/.claude>/.credentials.json
//                 (macOS falls back to the login keychain item)
//   Codex CLI   : ~/.codex/auth.json (tokens.access_token / account_id)
//   OpenCode    : <data dir>/opencode/auth.json ("opencode-zen" entry)
//
// Tokens are never persisted by prmptr; refreshed tokens are written back to
// the owning tool's own config file so that tool stays functional.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
    CliSubscriptionId,
    CliSubscriptionStatus,
    cliSubscriptionMeta,
} from "./cli-providers";

const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d6-9b3d-7956a7fe7251";
const CLAUDE_OAUTH_REFRESH_URL = "https://console.anthropic.com/v1/oauth/token";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_REFRESH_URL = "https://auth.openai.com/oauth/token";
/** Refresh proactively when a token expires within this window. */
const EXPIRY_SLACK_MS = 2 * 60_000;
/** In-memory cache TTL for resolved credentials (auth files are tiny; this
 * just avoids re-reading + refreshing on every request in a burst). */
const RESOLVED_CACHE_TTL_MS = 60_000;

function readJson<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

async function tryReadJsonFile(path: string): Promise<unknown | null> {
    try {
        return readJson(await readFile(path, "utf8"));
    } catch {
        return null;
    }
}

/** Decode a JWT payload without verifying signatures — only used to read
 * non-sensitive claims (email/exp) from the user's own local token files. */
function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function tokenExpiresAtMs(token: string | undefined): number | undefined {
    const exp = decodeJwtPayload(token)?.exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// ── Claude Code ───────────────────────────────────────────────

interface ClaudeOauthCreds {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
}

function claudeCredentialsPath(): string {
    const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
    return configDir
        ? join(configDir, ".credentials.json")
        : join(homedir(), ".claude", ".credentials.json");
}

interface ClaudeCredentialRead {
    creds: ClaudeOauthCreds | null;
    /** Path to persist refreshed tokens back to (null for keychain-sourced). */
    persistPath: string | null;
}

function parseClaudeOauth(parsed: unknown): ClaudeOauthCreds | null {
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const oauth = (root.claudeAiOauth ?? root) as Record<string, unknown>;
    if (typeof oauth.accessToken !== "string" || !oauth.accessToken) return null;
    return {
        accessToken: oauth.accessToken,
        refreshToken: typeof oauth.refreshToken === "string" ? oauth.refreshToken : undefined,
        expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : undefined,
    };
}

/** Read the keychain item Claude Code uses on macOS when no credentials file
 * exists. Best-effort; returns raw JSON or null. */
function readClaudeKeychainCredentials(): Promise<string | null> {
    if (process.platform !== "darwin") return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(
            "security",
            ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
            { timeout: 5_000 },
            (err, stdout) => resolve(err || !stdout ? null : stdout)
        );
    });
}

async function readClaudeCredentials(): Promise<ClaudeCredentialRead> {
    const path = claudeCredentialsPath();
    const parsed = await tryReadJsonFile(path);
    const creds = parseClaudeOauth(parsed);
    if (creds) return { creds, persistPath: path };

    const keychainRaw = await readClaudeKeychainCredentials();
    const keychainParsed = keychainRaw ? readJson(keychainRaw.trim()) : null;
    const keychainCreds = parseClaudeOauth(keychainParsed);
    if (keychainCreds) return { creds: keychainCreds, persistPath: null };

    return { creds: null, persistPath: null };
}

async function writeClaudeCredentials(path: string, creds: ClaudeOauthCreds): Promise<void> {
    // Preserve the wrapper shape Claude Code expects.
    await writeFile(
        path,
        JSON.stringify({ claudeAiOauth: creds }, null, 2),
        "utf8"
    ).catch(() => {});
}

async function refreshClaudeToken(refreshToken: string): Promise<ClaudeOauthCreds | null> {
    const data = await postJson(CLAUDE_OAUTH_REFRESH_URL, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
    });
    const accessToken = typeof data?.access_token === "string" ? data.access_token : null;
    if (!accessToken || !data) return null;
    return {
        accessToken,
        refreshToken:
            typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
        expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    };
}

// ── Codex CLI ─────────────────────────────────────────────────

interface CodexTokens {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
}

interface CodexAuthFile {
    tokens?: CodexTokens;
    OPENAI_API_KEY?: string;
    last_refresh?: string;
}

function codexAuthPath(): string {
    return join(homedir(), ".codex", "auth.json");
}

async function readCodexAuth(): Promise<CodexAuthFile | null> {
    const parsed = await tryReadJsonFile(codexAuthPath());
    return parsed && typeof parsed === "object" ? (parsed as CodexAuthFile) : null;
}

async function writeCodexAuth(auth: CodexAuthFile): Promise<void> {
    await writeFile(codexAuthPath(), JSON.stringify(auth, null, 2), "utf8").catch(() => {});
}

async function refreshCodexTokens(tokens: CodexTokens): Promise<CodexTokens | null> {
    if (!tokens.refresh_token) return null;
    const data = await postJson(CODEX_OAUTH_REFRESH_URL, {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: CODEX_OAUTH_CLIENT_ID,
    });
    const accessToken = typeof data?.access_token === "string" ? data.access_token : null;
    if (!accessToken || !data) return null;
    return {
        ...tokens,
        access_token: accessToken,
        id_token: typeof data.id_token === "string" ? data.id_token : tokens.id_token,
        refresh_token:
            typeof data.refresh_token === "string" ? data.refresh_token : tokens.refresh_token,
    };
}

// ── OpenCode ──────────────────────────────────────────────────

type OpencodeAuthEntry =
    | { type: "api"; key?: string }
    | { type: "oauth"; access?: string; refresh?: string; expiry?: string }
    | Record<string, unknown>;

function opencodeAuthCandidates(): string[] {
    const candidates: string[] = [];
    const xdgData = process.env.XDG_DATA_HOME?.trim();
    if (xdgData) candidates.push(join(xdgData, "opencode", "auth.json"));
    candidates.push(join(homedir(), ".local", "share", "opencode", "auth.json"));
    if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA?.trim();
        if (localAppData) candidates.push(join(localAppData, "opencode", "auth.json"));
        const appData = process.env.APPDATA?.trim();
        if (appData) candidates.push(join(appData, "opencode", "auth.json"));
    }
    return candidates;
}

interface OpencodeZenCred {
    token: string;
    isExpired: boolean;
}

function credFromOpencodeEntry(entry: OpencodeAuthEntry): OpencodeZenCred | null {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.key === "string" && record.key) {
        return { token: record.key, isExpired: false };
    }
    if (typeof record.access === "string" && record.access) {
        let expired = false;
        if (typeof record.expiry === "string" && record.expiry) {
            const expiryMs = Date.parse(record.expiry);
            expired = Number.isFinite(expiryMs) && expiryMs <= Date.now() + EXPIRY_SLACK_MS;
        }
        return { token: record.access, isExpired: expired };
    }
    return null;
}

/**
 * Only these auth.json entries hold credentials valid for the OpenCode Zen
 * gateway. Users/tools name them inconsistently — observed in the wild:
 * "opencode-zen", "opencode", "opencode-go". Third-party keys stored by
 * `opencode auth login` (anthropic, openai, lm-studio, …) are NOT valid Zen
 * credentials and must be skipped.
 */
function isZenCapableEntryId(id: string): boolean {
    return /zen/i.test(id) || /^opencode(-|$)/i.test(id);
}

function zenEntrySortScore(id: string): number {
    // "zen"-named entries first (the canonical Zen key), then plain
    // "opencode"/"opencode-*" keys.
    return /zen/i.test(id) ? 0 : 1;
}

async function readOpencodeZenCredential(): Promise<OpencodeZenCred | null> {
    let fallback: OpencodeZenCred | null = null;
    for (const path of opencodeAuthCandidates()) {
        const parsed = await tryReadJsonFile(path);
        if (!parsed || typeof parsed !== "object") continue;
        const entries = parsed as Record<string, OpencodeAuthEntry>;
        const usableIds = Object.keys(entries)
            .filter((id) => isZenCapableEntryId(id))
            .sort((a, b) => zenEntrySortScore(a) - zenEntrySortScore(b) || a.localeCompare(b));
        for (const id of usableIds) {
            const cred = credFromOpencodeEntry(entries[id]);
            if (!cred?.token) continue;
            if (!cred.isExpired) return cred;
            fallback ??= cred;
        }
    }
    return fallback;
}

/**
 * Resolve the OpenCode credential for a specific provider-group (e.g.
 * `opencode` vs `opencode-go`). OpenCode auth.json can hold *multiple*
 * gateway keys, each valid for its own plan (Zen "opencode" vs the paid
 * "opencode-go" group). The model identity carries the group as `subProvider`,
 * so a "go" model must use the `opencode-go` key — never the plain Zen key.
 *
 * When `group` is unknown/absent we fall back to the canonical Zen credential,
 * matching the legacy single-key behaviour.
 */
async function resolveOpencodeCredentialForGroup(group?: string): Promise<CliCredential | null> {
    if (!group || group === "opencode") {
        return resolveOpencodeCliCredential();
    }

    // Normalize the group to an auth.json id. The CLI reports the prefix as
    // `opencode-go`; auth.json keys it the same way (mirroring this).
    const normalizedGroup = group.trim().replace(/\/+$/, "");
    for (const path of opencodeAuthCandidates()) {
        const parsed = await tryReadJsonFile(path);
        if (!parsed || typeof parsed !== "object") continue;
        const entries = parsed as Record<string, OpencodeAuthEntry>;
        // Prefer an exact match, then a "*-group" suffix match (e.g. group
        // `opencode-go` may be stored as `opencode-go` or `opencode_go`).
        const exact = entries[normalizedGroup];
        const entry =
            exact ??
            Object.entries(entries).find(([id]) => {
                const a = id.toLowerCase().replace(/[-_]/g, "");
                const b = normalizedGroup.toLowerCase().replace(/[-_]/g, "");
                return a === b || id.toLowerCase() === "opencode-go";
            })?.[1];
        const cred = entry ? credFromOpencodeEntry(entry) : null;
        if (cred?.token) return { token: cred.token };
    }
    // No group-specific key — fall back to the canonical Zen credential.
    return resolveOpencodeCliCredential();
}

// ── Credential resolution (call time) ─────────────────────────

export interface CliCredential {
    token: string;
    /** Codex ChatGPT backend requires the account id header. */
    accountId?: string;
}

const resolvedCache = new Map<
    CliSubscriptionId,
    { cred: CliCredential | null; expiresAt: number }
>();

function cacheGet(id: CliSubscriptionId): CliCredential | null | undefined {
    const hit = resolvedCache.get(id);
    if (!hit || hit.expiresAt <= Date.now()) return undefined;
    return hit.cred;
}

function cacheSet(id: CliSubscriptionId, cred: CliCredential | null): void {
    resolvedCache.set(id, { cred, expiresAt: Date.now() + RESOLVED_CACHE_TTL_MS });
}

export function invalidateCliCredentialCache(id?: CliSubscriptionId): void {
    if (id) resolvedCache.delete(id);
    else resolvedCache.clear();
}

async function resolveClaudeCliCredential(): Promise<CliCredential | null> {
    const cached = cacheGet("claude-cli");
    if (cached !== undefined) return cached;

    const { creds, persistPath } = await readClaudeCredentials();
    if (!creds?.accessToken) {
        cacheSet("claude-cli", null);
        return null;
    }

    let effective = creds;
    const expired =
        typeof creds.expiresAt === "number"
            ? creds.expiresAt <= Date.now() + EXPIRY_SLACK_MS
            : false;
    if (expired && creds.refreshToken) {
        const refreshed = await refreshClaudeToken(creds.refreshToken);
        if (refreshed?.accessToken) {
            effective = refreshed;
            if (persistPath) await writeClaudeCredentials(persistPath, refreshed);
        }
    }

    if (!effective.accessToken) {
        cacheSet("claude-cli", null);
        return null;
    }
    const cred: CliCredential = { token: effective.accessToken };
    cacheSet("claude-cli", cred);
    return cred;
}

async function resolveCodexCliCredential(): Promise<CliCredential | null> {
    const cached = cacheGet("codex-cli");
    if (cached !== undefined) return cached;

    const auth = await readCodexAuth();
    const tokens = auth?.tokens;
    if (!tokens?.access_token) {
        cacheSet("codex-cli", null);
        return null;
    }

    let effective = tokens;
    const expiresAtMs = tokenExpiresAtMs(tokens.access_token);
    if (!expiresAtMs || expiresAtMs <= Date.now() + EXPIRY_SLACK_MS) {
        const refreshed = await refreshCodexTokens(tokens);
        if (refreshed?.access_token) {
            effective = refreshed;
            if (auth) {
                await writeCodexAuth({ ...auth, tokens: refreshed, last_refresh: new Date().toISOString() });
            }
        }
    }

    if (!effective.access_token) {
        cacheSet("codex-cli", null);
        return null;
    }
    const cred: CliCredential = {
        token: effective.access_token,
        accountId: effective.account_id,
    };
    cacheSet("codex-cli", cred);
    return cred;
}

async function resolveOpencodeCliCredential(): Promise<CliCredential | null> {
    const cached = cacheGet("opencode-cli");
    if (cached !== undefined) return cached;

    const zen = await readOpencodeZenCredential();
    if (!zen?.token) {
        cacheSet("opencode-cli", null);
        return null;
    }
    const cred: CliCredential = { token: zen.token };
    cacheSet("opencode-cli", cred);
    return cred;
}

/**
 * Resolve the subscription credential for a CLI provider at call time.
 * Returns null when the CLI is not present/logged in.
 */
export async function resolveCliCredential(
    id: CliSubscriptionId
): Promise<CliCredential | null> {
    switch (id) {
        case "claude-cli":
            return resolveClaudeCliCredential();
        case "codex-cli":
            return resolveCodexCliCredential();
        case "opencode-cli":
            return resolveOpencodeCliCredential();
    }
}

/**
 * Like `resolveCliCredential("opencode-cli")`, but selects the credential
 * matching the model's provider-group (`subProvider`), so a `opencode-go`
 * model uses the `opencode-go` key rather than the plain Zen key.
 */
export async function resolveCliCredentialForSubProvider(
    id: CliSubscriptionId,
    subProvider?: string
): Promise<CliCredential | null> {
    if (id !== "opencode-cli" || !subProvider) {
        return resolveCliCredential(id);
    }
    return resolveOpencodeCredentialForGroup(subProvider);
}

// ── Detection ─────────────────────────────────────────────────

async function detectClaudeCli(): Promise<CliSubscriptionStatus> {
    const meta = cliSubscriptionMeta("claude-cli")!;
    let account: string | undefined;
    const claudeJson = await tryReadJsonFile(join(homedir(), ".claude.json"));
    if (claudeJson && typeof claudeJson === "object") {
        const email = (claudeJson as Record<string, unknown>).oauthAccount as
            | Record<string, unknown>
            | undefined;
        if (email && typeof email.emailAddress === "string") {
            account = email.emailAddress;
        }
    }

    const { creds } = await readClaudeCredentials();
    if (creds?.accessToken) {
        return { ...meta, detected: true, loggedIn: true, ...(account ? { account } : {}) };
    }
    if (account) {
        return {
            ...meta,
            detected: true,
            loggedIn: false,
            account,
            hint: "Logged in, but the OAuth credential isn't readable by prmptr on this platform.",
        };
    }
    return { ...meta, detected: false, loggedIn: false };
}

async function detectCodexCli(): Promise<CliSubscriptionStatus> {
    const meta = cliSubscriptionMeta("codex-cli")!;
    const auth = await readCodexAuth();
    const tokens = auth?.tokens;
    if (tokens?.access_token) {
        const email = decodeJwtPayload(tokens.id_token)?.email;
        return {
            ...meta,
            detected: true,
            loggedIn: true,
            ...(typeof email === "string" ? { account: email } : {}),
        };
    }
    if (auth?.OPENAI_API_KEY) {
        return {
            ...meta,
            detected: true,
            loggedIn: false,
            hint: "Codex has an API key but no ChatGPT login. Run: codex login",
        };
    }
    return { ...meta, detected: false, loggedIn: false };
}

async function detectOpencodeCli(): Promise<CliSubscriptionStatus> {
    const meta = cliSubscriptionMeta("opencode-cli")!;
    const zen = await readOpencodeZenCredential();
    if (zen?.token) {
        return { ...meta, detected: true, loggedIn: !zen.isExpired };
    }
    return { ...meta, detected: false, loggedIn: false };
}

/** Probe each supported CLI's well-known config files. Safe to call often —
 * these are small local reads and never spawn the CLIs themselves. */
export async function detectCliSubscriptions(): Promise<CliSubscriptionStatus[]> {
    const [claude, codex, opencode] = await Promise.all([
        detectClaudeCli().catch(() => ({ ...cliSubscriptionMeta("claude-cli")!, detected: false, loggedIn: false })),
        detectCodexCli().catch(() => ({ ...cliSubscriptionMeta("codex-cli")!, detected: false, loggedIn: false })),
        detectOpencodeCli().catch(() => ({ ...cliSubscriptionMeta("opencode-cli")!, detected: false, loggedIn: false })),
    ]);
    return [claude, codex, opencode];
}
