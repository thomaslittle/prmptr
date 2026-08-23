use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::screenpipe::config::ScreenpipeConfig;
use crate::screenpipe::manager::ScreenpipeManager;

pub const SPEECH_CONTEXT_SIDECAR_PORT: u16 = 43_112;

static SIDECAR: OnceLock<Mutex<ScreenpipeManager>> = OnceLock::new();

fn manager() -> &'static Mutex<ScreenpipeManager> {
    SIDECAR.get_or_init(|| Mutex::new(ScreenpipeManager::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechContextSidecarStatus {
    pub running: bool,
    pub healthy: bool,
    pub port: u16,
    pub base_url: String,
    pub message: String,
}

pub async fn start() -> Result<SpeechContextSidecarStatus, String> {
    let mut manager = manager().lock().await;
    if !manager.is_running() {
        manager.update_config(ScreenpipeConfig::context_sidecar(SPEECH_CONTEXT_SIDECAR_PORT));
        manager
            .start()
            .await
            .map_err(|error| format!("Unable to start OCR context sidecar: {error}"))?;
    }
    let health = manager.check_health().await;
    Ok(SpeechContextSidecarStatus {
        running: health.running,
        healthy: health.healthy,
        port: SPEECH_CONTEXT_SIDECAR_PORT,
        base_url: format!("http://localhost:{SPEECH_CONTEXT_SIDECAR_PORT}"),
        message: health.message,
    })
}

pub async fn stop() -> Result<(), String> {
    let mut manager = manager().lock().await;
    manager
        .stop()
        .await
        .map_err(|error| format!("Unable to stop OCR context sidecar: {error}"))
}

pub async fn status() -> SpeechContextSidecarStatus {
    let mut manager = manager().lock().await;
    let health = manager.check_health().await;
    SpeechContextSidecarStatus {
        running: health.running,
        healthy: health.healthy,
        port: SPEECH_CONTEXT_SIDECAR_PORT,
        base_url: format!("http://localhost:{SPEECH_CONTEXT_SIDECAR_PORT}"),
        message: health.message,
    }
}
