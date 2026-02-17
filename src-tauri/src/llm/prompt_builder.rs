use crate::transcription::transcript::TranscriptBuffer;

const BASE_INSTRUCTIONS: &str = r#"You are PRMPTR, a real-time audio assistant powered by Screenpipe.

You receive rolling transcripts of live conversation captured from the user's audio devices.
The user labeled "me" is your user. Everyone else is labeled "them" or with speaker labels.

Your job is to help the user based on the session context below. Be concise — the user is reading
your responses in a small overlay while doing something else. Format for quick scanning.

IMPORTANT RULES:
- If you detect a question in the transcription, prioritize answering it directly
- If no clear question, summarize the conversation and note key topics
- Don't repeat raw transcription back — synthesize and respond
- Use bullet points for easy scanning"#;

pub fn build_system_prompt(
    session_context: &str,
    response_style: &str,
    trigger_mode: &str,
) -> String {
    let style_instructions = match response_style {
        "concise" => "Response style: CONCISE — bullet points, short sentences, max 3-5 points.",
        "detailed" => "Response style: DETAILED — thorough answers, headers for organization.",
        "ai-voice" => "Response style: AI VOICE — return exactly one short spoken line with no markdown, bullets, titles, or explanation.",
        _ => "",
    };

    let trigger_info = match trigger_mode {
        "auto" => "Trigger: auto — a question or prompt was detected in the audio.",
        "manual" => "Trigger: manual — the user explicitly asked for your analysis.",
        "continuous" => "Trigger: continuous — periodic analysis of recent audio.",
        _ => "",
    };

    format!(
        "{}\n\n--- SESSION CONTEXT ---\n{}\n\n{}\n\n{}",
        BASE_INSTRUCTIONS,
        session_context,
        style_instructions,
        trigger_info
    )
}

pub fn build_user_message(transcript: &TranscriptBuffer) -> String {
    let text = transcript.formatted_text();
    if text.is_empty() {
        return "(No recent audio captured)".to_string();
    }
    format!(
        "Here is the recent audio transcript:\n\n{}\n\n---\n\nBased on the above, provide your response.",
        text
    )
}
