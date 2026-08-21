use super::openai::OpenAICompatibleClient;

/// Cerebras uses an OpenAI-compatible API.
pub fn new_cerebras_client(api_key: String) -> OpenAICompatibleClient {
    OpenAICompatibleClient::new(
        Some(api_key),
        "https://api.cerebras.ai/v1".to_string(),
        "cerebras".to_string(),
    )
}
