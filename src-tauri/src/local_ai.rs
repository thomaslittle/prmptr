//! "Your AI subscriptions" provider, backed by OriginLM (`originlm-kit`).
//!
//! OriginLM discovers the AI clients a user already has (Claude Code, Codex,
//! OpenCode, Gemini CLI, Ollama, LM Studio, ...) and runs turns *through
//! those clients*. Their credentials never leave them: PRMPTR never reads,
//! copies or refreshes a subscription token. That keeps us inside each
//! provider's terms (notably Anthropic's: Claude Code subscriptions may only be
//! used via Claude Code).
//!
//! The renderer gets three narrow commands — list models, complete, cancel —
//! and never supplies grants, paths, executables or raw OriginLM methods.
//! Everything is inert until the user first opens the model picker; each
//! completion runs in a fresh read-only session with native tools disabled.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use originlm_discovery::{ScanEnvironment, Scanner};
use originlm_kit::{ClientPolicy, EmbeddedClient, ExecutionGrant, InventorySource, Kit, Selection};
use originlm_platform::NativeFilesystem;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::Mutex;

/// Clients PRMPTR offers. Each is probed for metadata only after a scan.
const PROVIDERS: &[&str] = &[
    "claude_code",
    "codex",
    "opencode",
    "gemini_cli",
    "grok",
    "antigravity",
    "copilot",
    "cursor",
    "ollama",
    "lmstudio",
];
const WORKSPACE_ID: &str = "prmptr";
/// Native clients can take a while to boot; a stuck turn must still end.
const TURN_TIMEOUT: Duration = Duration::from_secs(120);

struct Inner {
    _kit: Kit,
    client: EmbeddedClient,
    workspace: PathBuf,
    granted: BTreeSet<String>,
    /// requestId → (sessionId, turnId) for cancellation.
    running: HashMap<String, (String, Option<String>)>,
}

#[derive(Default)]
pub struct LocalAi {
    inner: Mutex<Option<Inner>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModel {
    pub route_id: String,
    pub model_id: String,
    pub revision: String,
    pub native_id: String,
    pub name: String,
    pub provider_id: String,
    pub provider_name: String,
    pub is_default: bool,
    pub supports_image_input: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiSelection {
    pub route_id: String,
    pub model_id: String,
    pub revision: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LocalAiEvent {
    Delta { text: String },
    Status { message: String },
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn capability_supported(caps: &Value, id: &str) -> bool {
    caps.as_array().is_some_and(|list| {
        list.iter().any(|c| {
            c["id"] == id && c["support"] == "supported"
        })
    })
}

/// Local runtimes have no account to verify.
const ACCOUNTLESS: &[&str] = &["ollama", "lmstudio"];

/// The native OpenCode executable behind an npm install, if we can find it.
///
/// OpenCode's npm package installs a thin `opencode.cmd`/`opencode.ps1` shim
/// that runs `node_modules/@opencode/cli/bin/opencode.exe`. OriginLM resolves
/// the older unscoped `opencode-ai` layout only, so a shim discovered on `PATH`
/// probes as `RuntimeMissing` and OpenCode never lists a model. Discovery takes
/// a host-owned executable per provider, so hand it the binary the shim runs.
fn opencode_native_executable(env: &ScanEnvironment) -> Option<PathBuf> {
    let name = if cfg!(windows) { "opencode.exe" } else { "opencode" };
    let mut candidates = vec![
        env.home.join(".opencode/bin").join(name),
        env.app_data.join("npm/node_modules").join("@opencode/cli/bin").join(name),
        env.app_data.join("npm/node_modules").join("opencode-ai/bin").join(name),
    ];
    for dir in &env.search_path {
        for package in ["@opencode/cli", "opencode-ai"] {
            let bin = PathBuf::from("node_modules").join(package).join("bin").join(name);
            // A global npm prefix keeps packages beside `bin/`; a per-user
            // prefix keeps them under `../lib/node_modules`.
            candidates.push(dir.join(&bin));
            candidates.push(dir.join("..").join("lib").join(&bin));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// Discovery with PRMPTR's host-owned executable hints applied. Everything
/// else (profiles, connection ids, ordering) stays OriginLM's.
pub fn inventory_source() -> InventorySource {
    Arc::new(|cancel| {
        let mut environment = ScanEnvironment::from_process()?;
        if let Some(native) = opencode_native_executable(&environment) {
            environment
                .executable_overrides
                .insert("opencode".to_string(), native);
        }
        Scanner::new(NativeFilesystem).scan(&environment, cancel, |_| {})
    })
}

/// A connection can run turns only once OriginLM has verified its login
/// (or it needs none). Listing unverified profiles leads to `AuthRequired`.
fn connection_ready(provider_id: &str, connection: Option<&Value>) -> bool {
    ACCOUNTLESS.contains(&provider_id)
        || connection.is_some_and(|c| c["auth"]["state"] == "known" && c["auth"]["value"] == "authenticated")
}

/// Flatten an OriginLM snapshot into picker rows. Pure, for testing.
pub fn models_from_snapshot(snapshot: &Value) -> Vec<LocalAiModel> {
    let empty = Vec::new();
    let arr = |key: &str| snapshot[key].as_array().unwrap_or(&empty).clone();
    let connections: HashMap<String, Value> = arr("connections")
        .into_iter()
        .filter_map(|c| Some((c["id"].as_str()?.to_string(), c)))
        .collect();
    let routes: HashMap<String, Value> = arr("routes")
        .into_iter()
        .filter_map(|r| Some((r["id"].as_str()?.to_string(), r)))
        .collect();
    let mut out: Vec<LocalAiModel> = arr("models")
        .into_iter()
        .filter_map(|m| {
            let route = routes.get(m["routeId"].as_str()?)?;
            // A gateway connection (OpenCode, ...) publishes one route per
            // upstream. Filter on the app that was discovered, not the
            // upstream: `opencode-go` is still OpenCode.
            let connection = connections.get(route["connectionId"].as_str()?);
            let provider_id = connection
                .and_then(|c| c["providerId"].as_str())
                .or_else(|| route["providerId"].as_str())?
                .to_string();
            if !PROVIDERS.contains(&provider_id.as_str()) {
                return None;
            }
            if !connection_ready(&provider_id, connection) {
                return None;
            }
            let provider_name = connection
                .and_then(|c| c["displayName"].as_str())
                .or_else(|| route["displayName"].as_str())
                .unwrap_or(&provider_id)
                .to_string();
            Some(LocalAiModel {
                route_id: m["routeId"].as_str()?.to_string(),
                model_id: m["id"].as_str()?.to_string(),
                revision: m["revision"].as_str().unwrap_or_default().to_string(),
                native_id: m["nativeId"].as_str().unwrap_or_default().to_string(),
                name: m["name"].as_str().unwrap_or_default().to_string(),
                provider_id,
                provider_name,
                is_default: m["isDefault"].as_bool().unwrap_or(false),
                supports_image_input: capability_supported(&m["capabilities"], "input.image"),
            })
        })
        .collect();
    // Gateways list the same model on several routes (a subscription and a
    // metered one). Keep one row per app+model and prefer the route that is
    // included, so selecting it never silently bills a metered route.
    let included = |route_id: &str| {
        routes
            .get(route_id)
            .and_then(|r| r["billing"]["value"].as_str())
            .is_some_and(|mode| matches!(mode, "subscription" | "local"))
    };
    let mut best: HashMap<(String, String), LocalAiModel> = HashMap::new();
    for model in out {
        let key = (model.provider_name.clone(), model.native_id.clone());
        match best.get(&key) {
            // Keep the current row unless this route is included and that one is not.
            Some(current) if included(&current.route_id) || !included(&model.route_id) => {}
            _ => {
                best.insert(key, model);
            }
        }
    }
    let mut out: Vec<LocalAiModel> = best.into_values().collect();
    out.sort_by(|a, b| {
        (a.provider_name.as_str(), !a.is_default, a.name.as_str())
            .cmp(&(b.provider_name.as_str(), !b.is_default, b.name.as_str()))
    });
    out
}

impl LocalAi {
    async fn ensure(&self, app: &tauri::AppHandle) -> Result<tokio::sync::MutexGuard<'_, Option<Inner>>, String> {
        use tauri::Manager;
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let data = app.path().app_data_dir().map_err(err)?.join("originlm");
            let workspace = data.join("workspace");
            std::fs::create_dir_all(&workspace).map_err(err)?;
            let kit = Kit::builder()
                .state_dir(data.clone())
                .inventory(inventory_source())
                .execution(true)
                .build()
                .map_err(err)?;
            let policy = ClientPolicy {
                allow_passive_discovery: true,
                connection_ids: None,
                probe_provider_ids: PROVIDERS.iter().map(|p| p.to_string()).collect(),
                ..ClientPolicy::passive()
            };
            let client = kit.connect("prmptr", policy).map_err(err)?;
            *guard = Some(Inner {
                _kit: kit,
                client,
                workspace,
                granted: BTreeSet::new(),
                running: HashMap::new(),
            });
        }
        Ok(guard)
    }
}

#[tauri::command]
pub async fn local_ai_models(app: tauri::AppHandle, state: tauri::State<'_, LocalAi>) -> Result<Vec<LocalAiModel>, String> {
    let guard = state.ensure(&app).await?;
    let inner = guard.as_ref().expect("initialized");
    let scanned = inner.client.scan().await.map_err(err)?;
    // Metadata probes list each connection's live model catalog; a failing
    // probe (logged out, client missing) just yields no models for it.
    let mut last = scanned.clone();
    for connection in scanned.connections.iter().filter(|c| PROVIDERS.contains(&c.provider_id.as_str())) {
        match inner.client.probe(&connection.id).await {
            Ok(snapshot) => last = snapshot,
            Err(e) => log::info!("[local-ai] probe {} skipped: {e}", connection.provider_id),
        }
    }
    let value = serde_json::to_value(&last).map_err(err)?;
    Ok(models_from_snapshot(&value))
}

#[tauri::command]
pub async fn local_ai_complete(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalAi>,
    on_event: Channel<LocalAiEvent>,
    selection: LocalAiSelection,
    prompt: String,
    request_id: String,
    image_data_url: Option<String>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("Empty prompt".into());
    }
    let selection = Selection {
        route_id: selection.route_id,
        model_id: selection.model_id,
        revision: selection.revision,
        options: BTreeMap::new(),
    };

    // Setup under the lock; the long-running turn polls without holding it
    // so cancellation and other requests stay responsive.
    let session_id = {
        let mut guard = state.ensure(&app).await?;
        let inner = guard.as_mut().expect("initialized");
        inner
            .client
            .request::<Value>("selection.validate", json!({ "selection": selection }))
            .await
            .map_err(err)?;
        let snapshot = serde_json::to_value(inner.client.snapshot().await.map_err(err)?).map_err(err)?;
        let connection_id = snapshot["routes"]
            .as_array()
            .and_then(|routes| routes.iter().find(|r| r["id"] == selection.route_id.as_str()))
            .and_then(|r| r["connectionId"].as_str())
            .ok_or("That model is no longer available — refresh the model list")?
            .to_string();
        if !inner.granted.contains(&connection_id) {
            inner.granted.insert(connection_id);
            // Read-only text generation: no writes, no native tools, never
            // falls back to paid usage.
            inner
                .client
                .authorize_execution(ExecutionGrant {
                    connection_ids: inner.granted.clone(),
                    workspaces: BTreeMap::from([(WORKSPACE_ID.to_string(), inner.workspace.clone())]),
                    ..Default::default()
                })
                .map_err(err)?;
        }
        let session: Value = inner
            .client
            .request("sessions.create", json!({ "selection": selection, "workspaceId": WORKSPACE_ID }))
            .await
            .map_err(err)?;
        let session_id = session["id"].as_str().ok_or("OriginLM returned no session id")?.to_string();
        inner.running.insert(request_id.clone(), (session_id.clone(), None));

        let mut start = json!({ "sessionId": session_id, "prompt": prompt, "requestId": request_id });
        if let Some(data_url) = image_data_url.as_deref() {
            if let Some((media, data)) = data_url.strip_prefix("data:").and_then(|r| r.split_once(";base64,")) {
                match inner
                    .client
                    .request::<Value>("inputs.put", json!({ "sessionId": session_id, "mediaType": media, "dataBase64": data }))
                    .await
                {
                    Ok(input) => start["inputs"] = json!([{ "inputId": input["inputId"] }]),
                    Err(e) => log::info!("[local-ai] image not attached: {e}"),
                }
            }
        }
        let turn: Value = match inner.client.request("turns.start", start).await {
            Ok(t) => t,
            Err(e) => {
                let _ = inner.client.request::<Value>("sessions.close", json!({ "sessionId": session_id })).await;
                inner.running.remove(&request_id);
                return Err(err(e));
            }
        };
        if let Some(entry) = inner.running.get_mut(&request_id) {
            entry.1 = turn["turnId"].as_str().map(str::to_string);
        }
        session_id
    };

    let result = pump_events(&state, &session_id, &on_event).await;

    let guard = state.inner.lock().await;
    if let Some(inner) = guard.as_ref() {
        let _ = inner.client.request::<Value>("sessions.close", json!({ "sessionId": session_id })).await;
    }
    drop(guard);
    if let Some(inner) = state.inner.lock().await.as_mut() {
        inner.running.remove(&request_id);
    }
    result
}

async fn pump_events(state: &LocalAi, session_id: &str, on_event: &Channel<LocalAiEvent>) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + TURN_TIMEOUT;
    let mut after: Option<String> = None;
    let mut text = String::new();
    loop {
        if tokio::time::Instant::now() > deadline {
            return Err("The AI client did not finish within 2 minutes".into());
        }
        let page: Value = {
            let guard = state.inner.lock().await;
            let inner = guard.as_ref().ok_or("Local AI shut down")?;
            let mut params = json!({ "sessionId": session_id });
            if let Some(a) = &after {
                params["after"] = json!(a);
            }
            inner.client.request("events.read", params).await.map_err(err)?
        };
        for event in page["events"].as_array().cloned().unwrap_or_default() {
            if let Some(seq) = event["sequence"].as_str() {
                after = Some(seq.to_string());
            }
            let payload = &event["payload"];
            match payload["type"].as_str() {
                Some("text_delta") => {
                    let delta = payload["text"].as_str().unwrap_or_default();
                    text.push_str(delta);
                    let _ = on_event.send(LocalAiEvent::Delta { text: delta.to_string() });
                }
                Some("warning") => {
                    let _ = on_event.send(LocalAiEvent::Status {
                        message: payload["message"].as_str().unwrap_or_default().to_string(),
                    });
                }
                Some("error") => {
                    return Err(payload["message"].as_str().unwrap_or("AI client error").to_string());
                }
                Some("final") => {
                    return match payload["status"].as_str() {
                        Some("completed") | None => Ok(text),
                        Some("cancelled") => Err("Cancelled".into()),
                        Some(other) => Err(format!("AI client finished with status {other}")),
                    };
                }
                _ => {}
            }
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

#[tauri::command]
pub async fn local_ai_cancel(state: tauri::State<'_, LocalAi>, request_id: String) -> Result<(), String> {
    let guard = state.inner.lock().await;
    let Some(inner) = guard.as_ref() else { return Ok(()) };
    if let Some((_, Some(turn_id))) = inner.running.get(&request_id) {
        inner
            .client
            .request::<Value>("turns.cancel", json!({ "turnId": turn_id }))
            .await
            .map_err(err)?;
    }
    Ok(())
}

/// Close the embedded client on app exit without touching other apps' brokers.
pub fn shutdown(state: &LocalAi) {
    if let Ok(mut guard) = state.inner.try_lock() {
        if let Some(inner) = guard.take() {
            inner.client.stop_background();
            inner.client.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattens_snapshot_into_picker_rows() {
        let snapshot = json!({
            "connections": [
                {"id": "c1", "providerId": "claude_code", "displayName": "Claude Code",
                 "auth": {"state": "known", "value": "authenticated"}},
                {"id": "c3", "providerId": "claude_code", "displayName": "Claude Code · Profile 2",
                 "auth": {"state": "unknown", "reason": "not probed"}},
                {"id": "c4", "providerId": "ollama", "displayName": "Ollama", "auth": {"state": "unavailable", "reason": "no account"}}
            ],
            "routes": [
                {"id": "r1", "connectionId": "c1", "providerId": "claude_code", "displayName": "Claude Code"},
                {"id": "r2", "connectionId": "c2", "providerId": "environment", "displayName": "Env"},
                {"id": "r3", "connectionId": "c3", "providerId": "claude_code", "displayName": "Claude Code"},
                {"id": "r4", "connectionId": "c4", "providerId": "ollama", "displayName": "Ollama"}
            ],
            "models": [
                {"id": "m2", "routeId": "r1", "nativeId": "claude-sonnet-5-5", "name": "Sonnet 5.5", "revision": "1", "isDefault": false,
                 "capabilities": [{"id": "input.image", "support": "supported"}]},
                {"id": "m1", "routeId": "r1", "nativeId": "claude-haiku-5-5", "name": "Haiku 5.5", "revision": "1", "isDefault": true, "capabilities": []},
                {"id": "m3", "routeId": "r2", "nativeId": "x", "name": "Hidden", "revision": "1", "isDefault": false, "capabilities": []},
                {"id": "m4", "routeId": "r3", "nativeId": "claude-haiku-5-5", "name": "Unverified", "revision": "1", "isDefault": true, "capabilities": []},
                {"id": "m5", "routeId": "r4", "nativeId": "llama", "name": "Llama", "revision": "1", "isDefault": true, "capabilities": []}
            ]
        });
        let rows = models_from_snapshot(&snapshot);
        let ids: Vec<_> = rows.iter().map(|r| r.model_id.as_str()).collect();
        assert_eq!(ids, ["m1", "m2", "m5"], "unsupported providers and unverified logins are filtered out");
        assert!(!rows[0].supports_image_input);
        assert!(rows[1].supports_image_input);
        assert_eq!(rows[2].provider_name, "Ollama", "accountless local runtimes are kept");
    }

    #[test]
    fn keeps_the_subscription_route_when_a_gateway_lists_a_model_twice() {
        let snapshot = json!({
            "connections": [
                {"id": "oc", "providerId": "opencode", "displayName": "OpenCode · Default profile",
                 "auth": {"state": "known", "value": "authenticated"}}
            ],
            "routes": [
                {"id": "r-go", "connectionId": "oc", "providerId": "opencode-go", "displayName": "OpenCode / OpenCode Go",
                 "billing": {"state": "known", "value": "subscription"}},
                {"id": "r-zen", "connectionId": "oc", "providerId": "opencode", "displayName": "OpenCode / Default",
                 "billing": {"state": "unknown", "reason": "UPSTREAM_BILLING_NOT_REPORTED"}}
            ],
            "models": [
                {"id": "m-zen", "routeId": "r-zen", "nativeId": "gpt-6-luna", "name": "GPT-6 Luna", "revision": "1", "capabilities": []},
                {"id": "m-go", "routeId": "r-go", "nativeId": "gpt-6-luna", "name": "GPT-6 Luna", "revision": "1", "capabilities": []},
                {"id": "m-only-zen", "routeId": "r-zen", "nativeId": "big-pickle", "name": "Big Pickle", "revision": "1", "capabilities": []}
            ]
        });
        let rows = models_from_snapshot(&snapshot);
        assert_eq!(rows.len(), 2, "one row per model, not one per route");
        let luna = rows.iter().find(|r| r.native_id == "gpt-6-luna").unwrap();
        assert_eq!(luna.route_id, "r-go", "the included route wins over the metered one");
        assert_eq!(luna.provider_id, "opencode", "rows are keyed by the installed app");
        assert!(rows.iter().any(|r| r.native_id == "big-pickle"), "metered-only models are still offered");
    }

    #[test]
    fn lists_opencode_models_once_its_login_is_verified() {
        let snapshot = json!({
            "connections": [
                {"id": "oc", "providerId": "opencode", "displayName": "OpenCode · Default profile",
                 "auth": {"state": "known", "value": "authenticated", "freshness": "fresh"}},
                {"id": "oc2", "providerId": "opencode", "displayName": "OpenCode · Signed out",
                 "auth": {"state": "unknown", "reason": "OPENCODE_CREDENTIALS_CONFIGURED_NOT_VERIFIED"}}
            ],
            "routes": [
                {"id": "r1", "connectionId": "oc", "providerId": "opencode", "displayName": "OpenCode / OpenCode Go"},
                {"id": "r2", "connectionId": "oc2", "providerId": "opencode", "displayName": "OpenCode / Signed out"}
            ],
            "models": [
                {"id": "m1", "routeId": "r1", "nativeId": "claude-sonnet-5-5", "name": "Sonnet 5.5", "revision": "1", "capabilities": []},
                {"id": "m2", "routeId": "r2", "nativeId": "x", "name": "Should stay hidden", "revision": "1", "capabilities": []}
            ]
        });
        let rows = models_from_snapshot(&snapshot);
        assert_eq!(
            rows.iter().map(|r| r.model_id.as_str()).collect::<Vec<_>>(),
            ["m1"],
            "a verified OpenCode profile is listed; an unverified one stays hidden"
        );
        assert_eq!(rows[0].provider_name, "OpenCode · Default profile");
    }

    #[test]
    fn finds_the_native_opencode_binary_behind_the_npm_shim() {
        let root = std::env::temp_dir().join(format!("prmptr-opencode-{}", std::process::id()));
        let bin = root.join("node_modules/@opencode/cli/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let name = if cfg!(windows) { "opencode.exe" } else { "opencode" };
        std::fs::write(bin.join(name), b"binary").unwrap();
        let platform = if cfg!(windows) {
            originlm_discovery::HostPlatform::Windows
        } else if cfg!(target_os = "macos") {
            originlm_discovery::HostPlatform::Macos
        } else {
            originlm_discovery::HostPlatform::Linux
        };
        let mut env = ScanEnvironment::for_home(root.clone(), platform);
        env.search_path = vec![root.clone()];
        assert_eq!(opencode_native_executable(&env), Some(bin.join(name)));
        std::fs::remove_dir_all(&root).ok();
    }
}
