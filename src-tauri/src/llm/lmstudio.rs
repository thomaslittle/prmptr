use super::openai::OpenAICompatibleClient;

/// LM Studio uses the OpenAI-compatible API with no auth
pub fn new_lmstudio_client(base_url: Option<String>) -> OpenAICompatibleClient {
    let raw = base_url.unwrap_or_else(|| "http://localhost:1234/v1".to_string());
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    let url = if trimmed.ends_with("/v1") {
        trimmed
    } else {
        format!("{trimmed}/v1")
    };
    OpenAICompatibleClient::new(
        None,
        url,
        "lmstudio".to_string(),
    )
}
