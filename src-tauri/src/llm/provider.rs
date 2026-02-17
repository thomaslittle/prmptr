use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamToken {
    pub text: String,
    pub is_complete: bool,
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub system_prompt: String,
    pub user_message: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmProviderType {
    Anthropic,
    OpenAI,
    Groq,
    LmStudio,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn stream_response(
        &self,
        request: LlmRequest,
        token_sender: mpsc::Sender<StreamToken>,
    ) -> Result<(), String>;

    async fn validate(&self) -> Result<bool, String>;

    fn provider_name(&self) -> &str;

    async fn list_models(&self) -> Result<Vec<String>, String>;
}
