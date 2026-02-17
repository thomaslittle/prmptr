use super::openai::OpenAICompatibleClient;

/// Groq uses the OpenAI-compatible API
pub fn new_groq_client(api_key: String) -> OpenAICompatibleClient {
    OpenAICompatibleClient::new(
        Some(api_key),
        "https://api.groq.com/openai/v1".to_string(),
        "groq".to_string(),
    )
}
