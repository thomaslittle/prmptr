//! Native screen capture for "Include screenshot on Analyze" (replaces the
//! old screenpipe frame lookup). Captures the primary monitor, downsizes it so
//! vision requests stay small, and returns a JPEG data URL.

use base64::Engine;

const MAX_EDGE: u32 = 1280;

fn capture() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("No monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(monitors.first())
        .ok_or("No monitor found")?;
    let frame = monitor.capture_image().map_err(|e| format!("Screen capture failed: {e}"))?;
    let image = image::DynamicImage::ImageRgba8(frame);
    let (w, h) = (image.width(), image.height());
    let image = if w.max(h) > MAX_EDGE {
        image.resize(MAX_EDGE, MAX_EDGE, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80);
    image
        .to_rgb8()
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    ))
}

#[tauri::command]
pub async fn capture_screenshot() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(capture)
        .await
        .map_err(|e| format!("Screen capture crashed: {e}"))?
}
