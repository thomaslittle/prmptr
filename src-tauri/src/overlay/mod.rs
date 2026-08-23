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
    fn default() -> Self {
        Self { opacity: 0.90, font_scale: 1.0 }
    }
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
}

impl Default for OverlayManager {
    fn default() -> Self {
        Self {
            inner: Mutex::new(OverlayInner {
                enabled: false,
                config: OverlayWindowConfig::default(),
                content: OverlayContent::default(),
            }),
        }
    }
}

impl OverlayManager {
    fn snapshot(&self, app: &tauri::AppHandle) -> OverlayRuntimeState {
        let inner = self.inner.lock().expect("overlay state poisoned");
        let window = app.get_webview_window(OVERLAY_LABEL);
        OverlayRuntimeState {
            enabled: inner.enabled,
            window_exists: window.is_some(),
            visible: window.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(false),
            click_through: inner.config.click_through,
            capture_protected: inner.config.capture_protected,
            config: inner.config.clone(),
            content: inner.content.clone(),
        }
    }

    fn update_bounds(&self, position: Option<(i32, i32)>, size: Option<(u32, u32)>) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some((x, y)) = position {
                inner.config.x = Some(x);
                inner.config.y = Some(y);
            }
            if let Some((width, height)) = size {
                inner.config.width = width as f64;
                inner.config.height = height as f64;
            }
        }
    }
}

fn ensure_window(app: &tauri::AppHandle, config: &OverlayWindowConfig) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(window);
    }

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
        .content_protected(config.capture_protected)
        .shadow(false);

    if let (Some(x), Some(y)) = (config.x, config.y) {
        builder = builder.position(x as f64, y as f64);
    } else {
        builder = builder.center();
    }

    let window = builder
        .build()
        .map_err(|error| format!("Unable to create overlay window: {error}"))?;
    window
        .set_ignore_cursor_events(config.click_through)
        .map_err(|error| format!("Unable to apply overlay click-through state: {error}"))?;
    Ok(window)
}

fn emit_runtime(app: &tauri::AppHandle, manager: &OverlayManager) {
    let snapshot = manager.snapshot(app);
    let _ = app.emit_to("main", OVERLAY_RUNTIME_EVENT, &snapshot);
    let _ = app.emit_to(OVERLAY_LABEL, OVERLAY_RUNTIME_EVENT, &snapshot);
}

fn apply_window_config(window: &tauri::WebviewWindow, next: &OverlayWindowConfig, previous: Option<&OverlayWindowConfig>) -> Result<(), String> {
    window
        .set_content_protected(next.capture_protected)
        .map_err(|error| format!("Unable to apply overlay capture protection: {error}"))?;
    if let Err(error) = window.set_ignore_cursor_events(next.click_through) {
        if let Some(previous) = previous {
            let _ = window.set_content_protected(previous.capture_protected);
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
        let window = match ensure_window(&app, &config) {
            Ok(window) => window,
            Err(error) => return Err(error),
        };
        if let Err(error) = apply_window_config(&window, &config, None)
            .and_then(|_| window.show().map_err(|e| format!("Unable to show overlay: {e}")))
        {
            if !existed {
                let _ = window.destroy();
            }
            return Err(error);
        }
        let mut inner = manager
            .inner
            .lock()
            .map_err(|_| "Overlay state is unavailable".to_string())?;
        inner.enabled = true;
        inner.config = config;
    } else {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            window
                .destroy()
                .map_err(|error| format!("Unable to destroy overlay: {error}"))?;
        }
        let mut inner = manager
            .inner
            .lock()
            .map_err(|_| "Overlay state is unavailable".to_string())?;
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
    let previous = manager
        .inner
        .lock()
        .map_err(|_| "Overlay state is unavailable".to_string())?
        .config
        .clone();

    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        apply_window_config(&window, &config, Some(&previous))?;
    }
    manager
        .inner
        .lock()
        .map_err(|_| "Overlay state is unavailable".to_string())?
        .config = config;
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn toggle_overlay_visibility(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
) -> Result<OverlayRuntimeState, String> {
    let (enabled, config) = {
        let inner = manager
            .inner
            .lock()
            .map_err(|_| "Overlay state is unavailable".to_string())?;
        (inner.enabled, inner.config.clone())
    };
    if !enabled {
        return Err("Overlay is disabled. Enable it explicitly before showing it.".to_string());
    }

    let window = ensure_window(&app, &config)?;
    if window.is_visible().unwrap_or(false) {
        window
            .hide()
            .map_err(|error| format!("Unable to hide overlay: {error}"))?;
    } else {
        window
            .show()
            .map_err(|error| format!("Unable to show overlay: {error}"))?;
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
        window
            .hide()
            .map_err(|error| format!("Unable to hide overlay: {error}"))?;
    }
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn set_overlay_click_through(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    enabled: bool,
) -> Result<OverlayRuntimeState, String> {
    let overlay_enabled = manager
        .inner
        .lock()
        .map_err(|_| "Overlay state is unavailable".to_string())?
        .enabled;
    if !overlay_enabled {
        return Err("Overlay is disabled; click-through has no active runtime.".to_string());
    }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window
            .set_ignore_cursor_events(enabled)
            .map_err(|error| format!("Unable to change overlay click-through state: {error}"))?;
    }
    manager
        .inner
        .lock()
        .map_err(|_| "Overlay state is unavailable".to_string())?
        .config
        .click_through = enabled;
    emit_runtime(&app, &manager);
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub async fn publish_overlay_content(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
    content: OverlayContent,
) -> Result<OverlayRuntimeState, String> {
    let (enabled, config) = {
        let mut inner = manager
            .inner
            .lock()
            .map_err(|_| "Overlay state is unavailable".to_string())?;
        inner.content = content.clone();
        (inner.enabled, inner.config.clone())
    };

    if enabled {
        let window = ensure_window(&app, &config)?;
        let _ = app.emit_to(OVERLAY_LABEL, OVERLAY_CONTENT_EVENT, &content);
        if config.auto_show_on_response
            && (!content.current_response.trim().is_empty() || !content.responses.is_empty())
        {
            window
                .show()
                .map_err(|error| format!("Unable to auto-show overlay: {error}"))?;
        }
    }
    Ok(manager.snapshot(&app))
}

#[tauri::command]
pub fn get_overlay_state(
    app: tauri::AppHandle,
    manager: State<'_, OverlayManager>,
) -> OverlayRuntimeState {
    manager.snapshot(&app)
}

pub fn handle_window_event(app: &tauri::AppHandle, label: &str, event: &tauri::WindowEvent) {
    if label != OVERLAY_LABEL {
        return;
    }
    let manager = app.state::<OverlayManager>();
    match event {
        tauri::WindowEvent::Moved(position) => {
            manager.update_bounds(Some((position.x, position.y)), None);
            emit_runtime(app, &manager);
        }
        tauri::WindowEvent::Resized(size) => {
            manager.update_bounds(None, Some((size.width, size.height)));
            emit_runtime(app, &manager);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_bounds_are_clamped_to_sane_limits() {
        let config = OverlayWindowConfig {
            width: 50.0,
            height: 5000.0,
            ..Default::default()
        }
        .normalized();
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
}
