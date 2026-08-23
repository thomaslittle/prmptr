//! Compatibility bridge for the existing Tauri command names.
//!
//! Direct Deepgram now shares PRMPTR's greenfield audio capture/conditioning
//! pipeline and canonical transcript event with local engines.

pub use crate::speech::deepgram::{DirectDeepgramConfig, DirectDeepgramStreamManager};
