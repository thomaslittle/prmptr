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
//! completion runs read-only with native tools disabled. An idle session is
//! kept per PRMPTR conversation and reused for the next turn, so a native
//! client keeps its history and a model switch can carry OriginLM's canonical
//! transcript instead of starting over.

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

/// The OriginLM session kept for a conversation's next turn.
///
/// PRMPTR reuses an idle session instead of creating and closing one per
/// completion, so a native client keeps its own history and HTTP providers
/// keep their message array. `after` is the journal cursor already delivered to
/// the UI: the next turn polls from there so replayed text never leaks.
#[derive(Clone)]
struct HeldSession {
    session_id: String,
    route_id: String,
    model_id: String,
    revision: String,
    instructions: Option<String>,
    after: Option<String>,
    busy: bool,
}

impl HeldSession {
    fn matches(&self, selection: &LocalAiSelection) -> bool {
        self.route_id == selection.route_id
            && self.model_id == selection.model_id
            && self.revision == selection.revision
    }
}

struct Inner {
    _kit: Kit,
    client: EmbeddedClient,
    workspace: PathBuf,
    granted: BTreeSet<String>,
    /// requestId → (sessionId, turnId) for cancellation.
    running: HashMap<String, (String, Option<String>)>,
    /// conversationId → the session reused for that conversation's next turn.
    conversations: HashMap<String, HeldSession>,
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

/// A stable host conversation id for OriginLM's canonical transcript.
///
/// The renderer passes the PRMPTR session id (`session-<millis>-<random>`),
/// which already matches OriginLM's allowed alphabet and length. A missing id
/// still gets a valid one so a turn never fails just because no session row
/// exists yet.
fn stable_conversation_id(provided: Option<String>) -> String {
    provided
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("prmptr-{}", uuid::Uuid::new_v4()))
}

/// The app system/personality prompt: trimmed, with an empty prompt omitted so
/// OriginLM does not store an empty instruction block.
fn normalize_instructions(instructions: Option<String>) -> Option<String> {
    instructions
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

async fn create_session(
    client: &EmbeddedClient,
    selection: &Selection,
    conversation_id: &str,
    instructions: Option<&str>,
) -> Result<Value, String> {
    let mut params = json!({
        "selection": selection,
        "workspaceId": WORKSPACE_ID,
        "conversationId": conversation_id,
    });
    if let Some(instructions) = instructions {
        params["instructions"] = json!(instructions);
    }
    client.request("sessions.create", params).await.map_err(err)
}

fn session_id_of(session: &Value) -> Result<String, String> {
    session["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "OriginLM returned no session id".to_string())
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
    let out: Vec<LocalAiModel> = arr("models")
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
                conversations: HashMap::new(),
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
    conversation_id: Option<String>,
    instructions: Option<String>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("Empty prompt".into());
    }
    let wanted = selection;
    let selection = Selection {
        route_id: wanted.route_id.clone(),
        model_id: wanted.model_id.clone(),
        revision: wanted.revision.clone(),
        options: BTreeMap::new(),
    };

    // Setup under the lock; the long-running turn polls without holding it
    // so cancellation and other requests stay responsive.
    let (session_id, conversation, mut cursor) = {
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

        // The renderer supplies a stable id per PRMPTR session. OriginLM shares
        // its canonical transcript between sessions created with the same id.
        let conversation = stable_conversation_id(conversation_id);
        let instructions = normalize_instructions(instructions);
        let existing = inner.conversations.get(&conversation).cloned();

        let (session_id, after) = match existing {
            // A turn is still running for this conversation. Never close it
            // out from under the running request; a fresh session in the same
            // conversation is seeded from the canonical transcript instead.
            Some(held) if held.busy => {
                let session = create_session(&inner.client, &selection, &conversation, instructions.as_deref()).await?;
                (session_id_of(&session)?, None)
            }
            // Model or provider changed: switchModel carries the canonical
            // transcript to the new model. If it cannot (busy/unsupported),
            // every provider session is closed and a fresh one is opened in
            // the same conversation, which OriginLM seeds from the transcript.
            Some(held) if !held.matches(&wanted) => {
                match inner
                    .client
                    .request::<Value>(
                        "sessions.switchModel",
                        json!({
                            "sessionId": held.session_id,
                            "selection": selection,
                            "instructions": instructions,
                        }),
                    )
                    .await
                {
                    Ok(session) => (session_id_of(&session)?, None),
                    Err(e) => {
                        log::info!("[local-ai] switchModel failed, reseeding a fresh session: {e}");
                        let _ = inner
                            .client
                            .request::<Value>("sessions.close", json!({ "sessionId": held.session_id }))
                            .await;
                        let session =
                            create_session(&inner.client, &selection, &conversation, instructions.as_deref()).await?;
                        (session_id_of(&session)?, None)
                    }
                }
            }
            // New instructions on the same model must apply now: a fresh
            // session in the same conversation is seeded from the transcript.
            Some(held) if held.instructions != instructions => {
                let _ = inner
                    .client
                    .request::<Value>("sessions.close", json!({ "sessionId": held.session_id }))
                    .await;
                let session = create_session(&inner.client, &selection, &conversation, instructions.as_deref()).await?;
                (session_id_of(&session)?, None)
            }
            // Reuse the idle session and continue after the last journal
            // cursor so earlier text is never replayed into the UI.
            Some(held) => (held.session_id, held.after),
            None => {
                let session = create_session(&inner.client, &selection, &conversation, instructions.as_deref()).await?;
                (session_id_of(&session)?, None)
            }
        };

        inner.conversations.insert(
            conversation.clone(),
            HeldSession {
                session_id: session_id.clone(),
                route_id: wanted.route_id,
                model_id: wanted.model_id,
                revision: wanted.revision,
                instructions,
                after: after.clone(),
                busy: true,
            },
        );
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
                if inner.conversations.get(&conversation).is_some_and(|h| h.session_id == session_id) {
                    inner.conversations.remove(&conversation);
                }
                return Err(err(e));
            }
        };
        if let Some(entry) = inner.running.get_mut(&request_id) {
            entry.1 = turn["turnId"].as_str().map(str::to_string);
        }
        (session_id, conversation, after)
    };

    let result = pump_events(&state, &session_id, &mut cursor, &on_event).await;

    let mut guard = state.inner.lock().await;
    if let Some(inner) = guard.as_mut() {
        let is_held = inner
            .conversations
            .get(&conversation)
            .is_some_and(|held| held.session_id == session_id);
        if result.is_ok() && is_held {
            // The session stays open for this conversation's next turn.
            if let Some(held) = inner.conversations.get_mut(&conversation) {
                held.busy = false;
                held.after = cursor;
            }
        } else {
            let _ = inner.client.request::<Value>("sessions.close", json!({ "sessionId": session_id })).await;
            if is_held {
                inner.conversations.remove(&conversation);
            }
        }
        inner.running.remove(&request_id);
    }
    drop(guard);
    result
}

async fn pump_events(
    state: &LocalAi,
    session_id: &str,
    after: &mut Option<String>,
    on_event: &Channel<LocalAiEvent>,
) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + TURN_TIMEOUT;
    let mut text = String::new();
    loop {
        if tokio::time::Instant::now() > deadline {
            return Err("The AI client did not finish within 2 minutes".into());
        }
        let page: Value = {
            let guard = state.inner.lock().await;
            let inner = guard.as_ref().ok_or("Local AI shut down")?;
            let mut params = json!({ "sessionId": session_id });
            if let Some(a) = after.as_ref() {
                params["after"] = json!(a);
            }
            inner.client.request("events.read", params).await.map_err(err)?
        };
        for event in page["events"].as_array().cloned().unwrap_or_default() {
            if let Some(seq) = event["sequence"].as_str() {
                *after = Some(seq.to_string());
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
    fn keeps_the_prmptr_session_as_the_conversation_id() {
        assert_eq!(stable_conversation_id(Some("session-1750000000000-abc123".into())), "session-1750000000000-abc123");
        assert_eq!(stable_conversation_id(Some("  session-trimmed  ".into())), "session-trimmed");
    }

    #[test]
    fn generates_a_valid_conversation_id_when_none_is_supplied() {
        let generated = stable_conversation_id(None);
        assert!(generated.starts_with("prmptr-"), "unexpected id: {generated}");
        assert!(!generated.contains(char::is_whitespace));
        assert!(!generated.contains(char::is_uppercase));
        assert!(generated.len() <= 128);
        assert_ne!(generated, stable_conversation_id(None), "each missing id starts a separate conversation");
        assert!(stable_conversation_id(Some("   ".into())).starts_with("prmptr-"));
    }

    #[test]
    fn trims_instructions_and_omits_empty_ones() {
        assert_eq!(
            normalize_instructions(Some("  You are a concise copilot.\n".into())),
            Some("You are a concise copilot.".to_string())
        );
        assert_eq!(normalize_instructions(Some(" \n\t ".into())), None);
        assert_eq!(normalize_instructions(None), None);
    }

    #[test]
    fn recognises_a_changed_selection_for_the_same_conversation() {
        let held = HeldSession {
            session_id: "session-1".into(),
            route_id: "route-1".into(),
            model_id: "model-a".into(),
            revision: "1".into(),
            instructions: None,
            after: None,
            busy: false,
        };
        let same = LocalAiSelection { route_id: "route-1".into(), model_id: "model-a".into(), revision: "1".into() };
        let other_model =
            LocalAiSelection { route_id: "route-1".into(), model_id: "model-b".into(), revision: "1".into() };
        let other_route =
            LocalAiSelection { route_id: "route-2".into(), model_id: "model-a".into(), revision: "1".into() };
        assert!(held.matches(&same));
        assert!(!held.matches(&other_model));
        assert!(!held.matches(&other_route));
    }

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
