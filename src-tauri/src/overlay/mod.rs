use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "overlay";
pub const OVERLAY_CONTENT_EVENT: &str = "overlay-content";
pub const OVERLAY_RUNTIME_EVENT: &str = "overlay-runtime-state";

fn default_width() -> f64 { 420.0 }
fn default_height() -> f64 { 320.0 }
fn default_auto_show() -> bool { true }
fn default_capture_protected() -> bool { true }

#[cfg(target_os = "linux")]
fn can_persist_global_position() -> bool {
    !matches!(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        Some(value) if value.eq_ignore_ascii_case("wayland")
    )
}

#[cfg(not(target_os = "linux"))]
fn can_persist_global_position() -> bool { true }

fn capture_protection_supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCapabilities {
    pub platform: String,
    pub transparency_supported: bool,
    pub always_on_top_supported: bool,
    pub click_through_supported: bool,
    pub capture_protection_supported: bool,
    pub global_position_persistence_supported: bool,
}

fn overlay_capabilities() -> OverlayCapabilities {
    OverlayCapabilities {
        platform: std::env::consts::OS.to_string(),
        transparency_supported: cfg!(any(target_os = "windows", target_os = "macos", target_os = "linux")),
        always_on_top_supported: cfg!(any(target_os = "windows", target_os = "macos", target_os = "linux")),
        click_through_supported: cfg!(any(target_os = "windows", target_os = "macos", target_os = "linux")),
        capture_protection_supported: capture_protection_supported(),
        global_position_persistence_supported: can_persist_global_position(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayWindowConfig {
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default = "default_height")]
    pub height: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
    #[serde(default)]
    pub click_through: bool,
    #[serde(default = "default_auto_show")]
    pub auto_show_on_response: bool,
    #[serde(default = "default_capture_protected")]
    pub capture_protected: bool,
}

impl Default for OverlayWindowConfig {
    fn default() -> Self {
        Self {
            width: default_width(),
            height: default_height(),
            x: None,
            y: None,
            click_through: false,
            auto_show_on_response: true,
            capture_protected: true,
        }
    }
}

impl OverlayWindowConfig {
    fn normalized(mut self) -> Self {
        self.width = self.width.clamp(280.0, 1200.0);
        self.height = self.height.clamp(160.0, 1000.0);
        if !can_persist_global_position() {
            self.x = None;
            self.y = None;
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResponseItem {
    pub id: String,
    pub content: String,
    pub timestamp: String,
    pub model: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayAppearance {
    pub opacity: f32,
    pub font_scale: f32,
}

impl Default for OverlayAppearance {
    fn default() -> Self { Self { opacity: 0.90, font_scale: 1.0 } }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OverlayContent {
    pub responses: Vec<OverlayResponseItem>,
    pub current_response: String,
    pub is_streaming: bool,
    pub session_id: Option<String>,
    #[serde(default)]
    pub appearance: OverlayAppearance,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRuntimeState {
    pub enabled: bool,
    pub window_exists: bool,
    pub visible: bool,
    pub click_through: bool,
    pub capture_protected: bool,
    pub capabilities: OverlayCapabilities,
    pub config: OverlayWindowConfig,
    pub content: OverlayContent,
}

struct OverlayInner {
    enabled: bool,
    config: OverlayWindowConfig,
    content: OverlayContent,
}

pub struct OverlayManager {
    inner: Mutex<OverlayInner>,
    /// Serializes window creation. Two concurrent `set_overlay_enabled(true)`
    /// invocations (e.g. React StrictMode double-invoked effects in dev) can
    /// otherwise both observe "no window" and race `WebviewWindowBuilder`,
    /// producing an orphaned native window whose teardown can hang the main
    /// thread on Windows.
    create_lock: Mutex<()>,
}

impl Default for OverlayManager {
    fn default() -> Self {
        Self {
            inner: Mutex::new(OverlayInner {
                enabled: false,
                config: OverlayWindowConfig::default(),
                content: OverlayContent::default(),
            }),
            create_lock: Mutex::new(()),
        }
    }
}

impl OverlayManager {
    fn snapshot(&self, app: &tauri::AppHandle) -> OverlayRuntimeState {
        let inner = self.inner.lock().expect("overlay state poisoned");
        let window = app.get_webview_window(OVERLAY_LABEL);
        let capabilities = overlay_capabilities();
        OverlayRuntimeState {
            enabled: inner.enabled,
            window_exists: window.is_some(),
            visible: window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false),
            click_through: inner.config.click_through,
            capture_protected: inner.config.capture_protected && capabilities.capture_protection_supported,
            capabilities,
            config: inner.config.clone(),
            content: inner.content.clone(),
        }
    }

    fn update_bounds(&self, position: Option<(i32, i32)>, size: Option<(u32, u32)>) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some((x, y)) = position {
                if can_persist_global_position() {
                    inner.config.x = Some(x);
                    inner.config.y = Some(y);
                }
            }
            if let Some((width, height)) = size {
                inner.config.width = width as f64;
                inner.config.height = height as f64;
            }
        }
    }

    fn mark_destroyed(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.enabled = false;
        }
    }
}

fn should_auto_show(previous: &OverlayContent, next: &OverlayContent) -> bool {
    let stream_started = !previous.is_streaming && next.is_streaming;
    let previous_response = previous.responses.first().map(|item| item.id.as_str());
    let next_response = next.responses.first().map(|item| item.id.as_str());
    let new_completed_response = next_response.is_some() && next_response != previous_response;
    stream_started || new_completed_response
}

fn ensure_window(
    app: &tauri::AppHandle,
    manager: &OverlayManager,
    config: &OverlayWindowConfig,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) { return Ok(window); }
    // Hold the creation lock across the check-and-build so concurrent callers
    // cannot double-create the single overlay window.
    let _create_guard = manager.create_lock.lock().map_err(|_| "Overlay creation state is unavailable".to_string())?;
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) { return Ok(window); }
    let effective_capture_protection = config.capture_protected && capture_protection_supported();
    let mut builder = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay".into()))
        .title("PRMPTR Overlay")
        .inner_size(config.width, config.height)
        .min_inner_size(280.0, 160.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .content_protected(effective_capture_protection)
        .shadow(false);
    if let (Some(x), Some(y)) = (config.x, config.y) {
        builder = builder.position(x as f64, y as f64);
    } else {
        builder = builder.center();
    }
    let window = builder.build().map_err(|error| format!("Unable to create overlay window: {error}"))?;
    window.set_ignore_cursor_events(config.click_through)
        .map_err(|error| format!("Unable to apply overlay click-through state: {error}"))?;
    Ok(window)
}

fn emit_runtime(app: &tauri::AppHandle, manager: &OverlayManager) {
    emit_runtime_to(app, manager, true);
}

/// Broadcasts the runtime snapshot. `include_overlay` must be false while the
/// overlay webview is being destroyed: evaluating into a webview from inside
/// its own WM_DESTROY chain deadlocks WebView2 COM teardown on Windows.
fn emit_runtime_to(app: &tauri::AppHandle, manager: &OverlayManager, include_overlay: bool) {
    let snapshot = manager.snapshot(app);
    let _ = app.emit_to("main", OVERLAY_RUNTIME_EVENT, &snapshot);
    if include_overlay {
        let _ = app.emit_to(OVERLAY_LABEL, OVERLAY_RUNTIME_EVENT, &snapshot);
    }
}

fn apply_window_config(window: &tauri::WebviewWindow, next: &OverlayWindowConfig, previous: Option<&OverlayWindowConfig>) -> Result<(), String> {
    if capture_protection_supported() {
        window.set_content_protected(next.capture_protected)
            .map_err(|error| format!("Unable to apply overlay capture protection: {error}"))?;
    }
    if let Err(error) = window.set_ignore_cursor_events(next.click_through) {
        if capture_protection_supported() {
            if let Some(previous) = previous {
                let _ = window.set_content_protected(previous.capture_protected);
            }
        }
        return Err(format!("Unable to apply overlay click-through state: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_overlay_enabled(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    enabled: bool,
    config: OverlayWindowConfig,
) -> Result<OverlayRuntimeState, String> {
    let config = config.normalized();
    if enabled {
        let existed = app.get_webview_window(OVERLAY_LABEL).is_some();
        let window = ensure_window(&app, &manager, &config)?;
        if let Err(error) = apply_window_config(&window, &config, None)
            .and_then(|_| window.show().map_err(|e| format!("Unable to show overlay: {e}")))
        {
            if !existed { let _ = window.destroy(); }
            return Err(error);
        }
        let mut inner = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?;
        inner.enabled = true;
        inner.config = config;
    } else {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            // Windows: destroying a content-protected (WDA_EXCLUDEFROMCAPTURE)
            // WebView2 deadlocks the main thread inside DWM/WebView2 teardown.
            // Drop the display-affinity flag first, then destroy off the invoke
            // stack so in-flight page work and this command's runtime broadcast
            // settle before WM_DESTROY runs.
            if capture_protection_supported() {
                let _ = window.set_content_protected(false);
            }
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(120));
                let _ = window.destroy();
            });
        }
        let mut inner = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?;
        inner.enabled = false;
        inner.config = config;
    }
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn apply_overlay_config(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    config: OverlayWindowConfig,
) -> Result<OverlayRuntimeState, String> {
    let config = config.normalized();
    let previous = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?.config.clone();
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        apply_window_config(&window, &config, Some(&previous))?;
    }
    manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?.config = config;
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn toggle_overlay_visibility(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
) -> Result<OverlayRuntimeState, String> {
    let (enabled, config) = {
        let inner = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?;
        (inner.enabled, inner.config.clone())
    };
    if !enabled { return Err("Overlay is disabled. Enable it explicitly before showing it.".to_string()); }
    let window = ensure_window(&app, &manager, &config)?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|error| format!("Unable to hide overlay: {error}"))?;
    } else {
        window.show().map_err(|error| format!("Unable to show overlay: {error}"))?;
    }
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn hide_overlay(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
) -> Result<OverlayRuntimeState, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.hide().map_err(|error| format!("Unable to hide overlay: {error}"))?;
    }
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn center_overlay(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
) -> Result<OverlayRuntimeState, String> {
    let (enabled, mut config) = {
        let inner = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?;
        (inner.enabled, inner.config.clone())
    };
    if !enabled { return Err("Overlay is disabled. Enable it before centering it.".to_string()); }
    config.x = None;
    config.y = None;
    let window = ensure_window(&app, &manager, &config)?;
    window.center().map_err(|error| format!("Unable to center overlay: {error}"))?;
    let position = window.outer_position().ok().map(|p| (p.x, p.y));
    manager.update_bounds(position, None);
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn set_overlay_click_through(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    enabled: bool,
) -> Result<OverlayRuntimeState, String> {
    let overlay_enabled = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?.enabled;
    if !overlay_enabled { return Err("Overlay is disabled; click-through has no active runtime.".to_string()); }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window.set_ignore_cursor_events(enabled)
            .map_err(|error| format!("Unable to change overlay click-through state: {error}"))?;
    }
    manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?.config.click_through = enabled;
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn publish_overlay_content(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    content: OverlayContent,
    allow_auto_show: bool,
) -> Result<OverlayRuntimeState, String> {
    let (enabled, config, auto_show_now) = {
        let mut inner = manager.inner.lock().map_err(|_| "Overlay state is unavailable".to_string())?;
        let auto_show_now = should_auto_show(&inner.content, &content);
        inner.content = content.clone();
        (inner.enabled, inner.config.clone(), auto_show_now)
    };
    if enabled {
        let window = ensure_window(&app, &manager, &config)?;
        let _ = app.emit_to(OVERLAY_LABEL, OVERLAY_CONTENT_EVENT, &content);
        if allow_auto_show && config.auto_show_on_response && auto_show_now {
            window.show().map_err(|error| format!("Unable to auto-show overlay: {error}"))?;
        }
    }
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub fn get_overlay_state(app: tauri::AppHandle, manager: State<'_, OverlayManager>) -> OverlayRuntimeState {
    manager.snapshot(&app)
}

pub fn handle_window_event(app: &tauri::AppHandle, label: &str, event: &tauri::WindowEvent) {
    if label != OVERLAY_LABEL { return; }
    let manager = app.state::<OverlayManager>();
    match event {
        tauri::WindowEvent::Moved(position) => {
            if can_persist_global_position() {
                manager.update_bounds(Some((position.x, position.y)), None);
                emit_runtime(app, &manager);
            }
        }
        tauri::WindowEvent::Resized(size) => {
            manager.update_bounds(None, Some((size.width, size.height)));
            emit_runtime(app, &manager);
        }
        tauri::WindowEvent::Destroyed => {
            manager.mark_destroyed();
            // The overlay webview is gone or dying; never evaluate into it here.
            emit_runtime_to(app, &manager, false);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(id: &str) -> OverlayResponseItem {
        OverlayResponseItem {
            id: id.to_string(),
            content: "test".to_string(),
            timestamp: "2026-08-23T00:00:00Z".to_string(),
            model: "test".to_string(),
            kind: Some("analysis".to_string()),
        }
    }

    #[test]
    fn overlay_bounds_are_clamped_to_sane_limits() {
        let config = OverlayWindowConfig { width: 50.0, height: 5000.0, ..Default::default() }.normalized();
        assert_eq!(config.width, 280.0);
        assert_eq!(config.height, 1000.0);
    }

    #[test]
    fn overlay_is_opt_in_and_capture_protected_by_default() {
        let manager = OverlayManager::default();
        let inner = manager.inner.lock().unwrap();
        assert!(!inner.enabled);
        assert!(inner.config.capture_protected);
        assert!(!inner.config.click_through);
    }

    #[test]
    fn auto_show_only_triggers_on_new_response_activity() {
        let empty = OverlayContent::default();
        let streaming = OverlayContent { is_streaming: true, ..Default::default() };
        assert!(should_auto_show(&empty, &streaming));

        let streaming_token = OverlayContent {
            is_streaming: true,
            current_response: "hello".to_string(),
            ..Default::default()
        };
        assert!(!should_auto_show(&streaming, &streaming_token));

        let completed = OverlayContent {
            responses: vec![response("response-1")],
            ..Default::default()
        };
        assert!(should_auto_show(&streaming_token, &completed));
        assert!(!should_auto_show(&completed, &completed));

        let appearance_only = OverlayContent {
            responses: vec![response("response-1")],
            appearance: OverlayAppearance { opacity: 0.5, font_scale: 1.2 },
            ..Default::default()
        };
        assert!(!should_auto_show(&completed, &appearance_only));
    }
}
