use std::sync::Arc;
use tokio::sync::Mutex;

use crate::screenpipe::manager::ScreenpipeManager;
use crate::transcription::transcript::TranscriptBuffer;
use crate::transcription::whisper_stream::WhisperStreamManager;
use crate::session::manager::SessionManager;

pub struct AppState {
    pub screenpipe: Arc<Mutex<ScreenpipeManager>>,
    pub transcript: Arc<Mutex<TranscriptBuffer>>,
    pub session: Arc<Mutex<SessionManager>>,
    pub whisper_stream: Arc<Mutex<WhisperStreamManager>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            screenpipe: Arc::new(Mutex::new(ScreenpipeManager::new())),
            transcript: Arc::new(Mutex::new(TranscriptBuffer::new(120))),
            session: Arc::new(Mutex::new(SessionManager::new())),
            whisper_stream: Arc::new(Mutex::new(WhisperStreamManager::new())),
        }
    }
}
