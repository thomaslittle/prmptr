use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

use super::provider::{LlmProvider, LlmRequest, StreamToken};

/// Shared OpenAI-compatible streaming client (used by OpenAI, Groq, LM Studio)
pub struct OpenAICompatibleClient {
    api_key: Option<String>,
    base_url: String,
    provider_name: String,
    client: Client,
}

impl OpenAICompatibleClient {
    pub fn new(api_key: Option<String>, base_url: String, provider_name: String) -> Self {
        Self {
            api_key,
            base_url,
            provider_name,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAICompatibleClient {
    async fn stream_response(
        &self,
        request: LlmRequest,
        tx: mpsc::Sender<StreamToken>,
    ) -> Result<(), String> {
        let body = serde_json::json!({
            "model": request.model,
            "max_tokens": request.max_tokens,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_message},
            ],
            "stream": true,
            "temperature": request.temperature,
        });

        let mut req = self.client
            .post(format!("{}/chat/completions", self.base_url))
            .header("content-type", "application/json");

        if let Some(ref key) = self.api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let resp = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("{} request failed: {}", self.provider_name, e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("{} API error {}: {}", self.provider_name, status, text));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].to_string();
                buffer = buffer[pos + 1..].to_string();

                if let Some(data) = line.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        let _ = tx.send(StreamToken {
                            text: String::new(),
                            is_complete: true,
                            usage: None,
                        }).await;
                        return Ok(());
                    }

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(content) = parsed
                            .pointer("/choices/0/delta/content")
                            .and_then(|c| c.as_str())
                        {
                            let _ = tx.send(StreamToken {
                                text: content.to_string(),
                                is_complete: false,
                                usage: None,
                            }).await;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn validate(&self) -> Result<bool, String> {
        let mut req = self.client
            .get(format!("{}/models", self.base_url));

        if let Some(ref key) = self.api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let resp = req.send().await
            .map_err(|e| format!("Validation failed: {}", e))?;

        Ok(resp.status().is_success())
    }

    fn provider_name(&self) -> &str {
        &self.provider_name
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        let mut req = self.client
            .get(format!("{}/models", self.base_url));

        if let Some(ref key) = self.api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let resp = req.send().await
            .map_err(|e| format!("Failed to list models: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        let data: serde_json::Value = resp.json().await
            .map_err(|e| format!("Failed to parse models: {}", e))?;

        Ok(data.get("data")
            .and_then(|d| d.as_array())
            .map(|arr| arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect())
            .unwrap_or_default())
    }
}
