use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggerMode {
    Auto,
    Manual,
    Continuous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponseStyle {
    Concise,
    Detailed,
    #[serde(rename = "ai-voice")]
    AiVoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub context: String,
    pub trigger_mode: TriggerMode,
    pub response_style: ResponseStyle,
    pub auto_interval_secs: u32,
    pub model: String,
    pub provider: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            context: "Listen to audio and respond to questions.".to_string(),
            trigger_mode: TriggerMode::Manual,
            response_style: ResponseStyle::Concise,
            auto_interval_secs: 15,
            model: "lmstudio-auto".to_string(),
            provider: "lmstudio".to_string(),
            temperature: 0.4,
            max_tokens: 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseEntry {
    pub id: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub model: String,
    pub provider: String,
}

pub struct SessionManager {
    pub active: bool,
    pub config: SessionConfig,
    pub started_at: Option<DateTime<Utc>>,
    pub responses: Vec<ResponseEntry>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            active: false,
            config: SessionConfig::default(),
            started_at: None,
            responses: Vec::new(),
        }
    }

    pub fn start(&mut self, config: SessionConfig) {
        self.config = config;
        self.active = true;
        self.started_at = Some(Utc::now());
        self.responses.clear();
    }

    pub fn end(&mut self) -> Option<SessionStats> {
        if !self.active {
            return None;
        }
        self.active = false;
        let started = self.started_at.take()?;
        let duration = (Utc::now() - started).num_seconds() as u64;
        Some(SessionStats {
            duration_secs: duration,
            response_count: self.responses.len(),
        })
    }

    pub fn add_response(&mut self, entry: ResponseEntry) {
        self.responses.push(entry);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub duration_secs: u64,
    pub response_count: usize,
}
