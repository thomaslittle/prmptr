use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;

use super::config::ScreenpipeConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionEvent {
    pub transcription: String,
    pub timestamp: String,
    pub device: Option<String>,
    pub speaker: Option<i32>,
    #[serde(rename = "isFinal")]
    pub is_final: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenpipeEvent {
    pub name: String,
    pub data: serde_json::Value,
}

/// Connect to screenpipe WebSocket and forward transcription events
pub async fn connect_websocket(
    config: &ScreenpipeConfig,
    tx: mpsc::Sender<TranscriptionEvent>,
) -> Result<(), String> {
    let ws_url = config.ws_url();
    log::info!("Connecting to screenpipe WebSocket: {}", ws_url);

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    log::info!("Connected to screenpipe WebSocket");

    let (_, mut read) = ws_stream.split();

    while let Some(msg) = read.next().await {
        match msg {
            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                if let Ok(event) = serde_json::from_str::<ScreenpipeEvent>(&text) {
                    if event.name == "transcription" {
                        if let Ok(data) = serde_json::from_value::<TranscriptionEvent>(event.data) {
                            // Filter blank transcriptions
                            let content = data.transcription.trim();
                            if content.is_empty() || content.contains("[BLANK_AUDIO]") {
                                continue;
                            }

                            if tx.send(data).await.is_err() {
                                log::warn!("Transcription receiver dropped");
                                break;
                            }
                        }
                    }
                }
            }
            Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => {
                log::info!("WebSocket closed by server");
                break;
            }
            Err(e) => {
                log::error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    Ok(())
}
