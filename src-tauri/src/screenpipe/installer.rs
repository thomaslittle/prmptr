use std::path::PathBuf;
use tauri::Emitter;
use serde::Serialize;

#[derive(Clone, Serialize)]
struct InstallProgress {
    stage: String,
    percent: u8,
}

fn emit_progress(app: &tauri::AppHandle, stage: &str, percent: u8) {
    let _ = app.emit("screenpipe-install-progress", InstallProgress {
        stage: stage.to_string(),
        percent,
    });
}

/// Fetch the latest release tag from GitHub (e.g. "v0.3.135")
async fn get_latest_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("prmptr-installer")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get("https://api.github.com/repos/mediar-ai/screenpipe/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Failed to parse release JSON: {e}"))?;

    body["tag_name"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No tag_name in release response".to_string())
}

/// Build the download URL for the platform-appropriate asset.
fn get_asset_url(version: &str) -> Result<String, String> {
    let target = if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else {
        "x86_64-unknown-linux-gnu"
    };

    let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
    let url = format!(
        "https://github.com/mediar-ai/screenpipe/releases/download/{version}/screenpipe-{version}-{target}.{ext}"
    );
    Ok(url)
}

/// Install directory: ~/.screenpipe/bin/
fn install_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".screenpipe").join("bin"))
}

/// Download the latest screenpipe release and extract the binary to ~/.screenpipe/bin/.
/// Emits `screenpipe-install-progress` events throughout.
/// Returns the path to the installed binary.
pub async fn download_and_install(app: &tauri::AppHandle) -> Result<String, String> {
    // 1. Check latest version
    emit_progress(app, "Checking latest version...", 0);
    let version = get_latest_version().await?;
    log::info!("Latest screenpipe version: {version}");

    // 2. Build download URL
    let url = get_asset_url(&version)?;
    emit_progress(app, "Downloading...", 10);
    log::info!("Downloading {url}");

    // 3. Stream-download with progress
    let client = reqwest::Client::builder()
        .user_agent("prmptr-installer")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client.get(&url).send().await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned HTTP {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::new();

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);

        if total_size > 0 {
            // Map download progress to 10-80%
            let pct = 10 + ((downloaded as f64 / total_size as f64) * 70.0) as u8;
            emit_progress(app, "Downloading...", pct.min(80));
        }
    }

    // 4. Extract
    emit_progress(app, "Extracting...", 80);
    let dest = install_dir()?;
    std::fs::create_dir_all(&dest)
        .map_err(|e| format!("Failed to create install dir: {e}"))?;

    let binary_name = if cfg!(target_os = "windows") { "screenpipe.exe" } else { "screenpipe" };
    let binary_path = dest.join(binary_name);

    if cfg!(target_os = "windows") {
        extract_zip(&bytes, &binary_path)?;
    } else {
        extract_tar_gz(&bytes, &binary_path)?;
    }

    // 5. Set executable permission on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to read file metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set executable permission: {e}"))?;
    }

    emit_progress(app, "Done", 100);

    let path_str = binary_path.to_string_lossy().to_string();
    log::info!("Screenpipe installed to {path_str}");
    Ok(path_str)
}

/// Extract screenpipe.exe from a .zip archive
fn extract_zip(data: &[u8], dest: &PathBuf) -> Result<(), String> {
    use std::io::{Cursor, Read};

    let reader = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Failed to open zip: {e}"))?;

    let target_name = if cfg!(target_os = "windows") { "screenpipe.exe" } else { "screenpipe" };

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;

        let name = file.name().to_string();
        // Look for the binary — it might be at root or inside a directory
        if name.ends_with(target_name) && !name.contains("__MACOSX") {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read {name} from zip: {e}"))?;
            std::fs::write(dest, &buf)
                .map_err(|e| format!("Failed to write binary: {e}"))?;
            return Ok(());
        }
    }

    Err(format!("{target_name} not found in zip archive"))
}

/// Extract screenpipe from a .tar.gz archive
fn extract_tar_gz(data: &[u8], dest: &PathBuf) -> Result<(), String> {
    use std::io::{Cursor, Read};
    use flate2::read::GzDecoder;

    let reader = Cursor::new(data);
    let gz = GzDecoder::new(reader);
    let mut archive = tar::Archive::new(gz);

    let target_name = "screenpipe";

    for entry in archive.entries().map_err(|e| format!("Failed to read tar: {e}"))? {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {e}"))?;
        let path = entry.path().map_err(|e| format!("Invalid path in tar: {e}"))?;
        let path_str = path.to_string_lossy().to_string();

        // Match the binary (could be "screenpipe" or "*/screenpipe")
        if path_str.ends_with(target_name)
            && !path_str.ends_with(".d")
            && !path_str.contains("__MACOSX")
        {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)
                .map_err(|e| format!("Failed to read {path_str} from tar: {e}"))?;
            std::fs::write(dest, &buf)
                .map_err(|e| format!("Failed to write binary: {e}"))?;
            return Ok(());
        }
    }

    Err(format!("{target_name} not found in tar.gz archive"))
}
