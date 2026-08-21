use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use serde::{Deserialize, Serialize};

use super::config::ScreenpipeConfig;
use crate::errors::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenpipeStatus {
    pub running: bool,
    pub healthy: bool,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

/// Ring buffer that keeps the last N bytes of process output for diagnostics.
struct OutputBuffer {
    data: String,
    max_bytes: usize,
}

impl OutputBuffer {
    fn new(max_bytes: usize) -> Self {
        Self { data: String::new(), max_bytes }
    }

    fn push(&mut self, text: &str) {
        self.data.push_str(text);
        if self.data.len() > self.max_bytes {
            let excess = self.data.len() - self.max_bytes;
            self.data.drain(..excess);
        }
    }

    /// Extract the most useful error info from process output.
    /// For Rust panics the message is on the line AFTER the "panicked at" location.
    fn error_summary(&self) -> String {
        let lines: Vec<&str> = self.data.lines()
            .filter(|l| !l.trim().is_empty())
            .collect();

        // Look for panic: grab the "panicked at" line + the next line (the actual message)
        for (i, line) in lines.iter().enumerate() {
            if line.contains("panicked at") {
                let mut msg = line.trim().to_string();
                // In newer Rust, the panic message follows on the next line
                if let Some(next) = lines.get(i + 1) {
                    let next = next.trim();
                    if !next.contains("RUST_BACKTRACE") && !next.contains("stack backtrace") {
                        msg = format!("{} {}", msg, next);
                    }
                }
                return msg;
            }
        }

        // Look for error lines
        for keyword in &["Error:", "error:", "FATAL", "fatal"] {
            if let Some(line) = lines.iter().find(|l| l.contains(keyword)) {
                return line.trim().to_string();
            }
        }

        // Fall back to last 3 meaningful lines (skip backtrace hints)
        let useful: Vec<&str> = lines.iter()
            .rev()
            .filter(|l| !l.contains("RUST_BACKTRACE") && !l.contains("stack backtrace"))
            .take(3)
            .copied()
            .collect();

        if useful.is_empty() {
            String::new()
        } else {
            useful.into_iter().rev().collect::<Vec<_>>().join(" | ")
        }
    }

    fn text(&self) -> &str {
        &self.data
    }
}

pub struct ScreenpipeManager {
    config: ScreenpipeConfig,
    process: Option<Child>,
    binary_path: Option<String>,
    /// The last command that was executed (for debugging)
    last_command: Option<String>,
    /// Background-captured stderr output (shared with reader task)
    captured_output: Arc<TokioMutex<OutputBuffer>>,
}

impl ScreenpipeManager {
    /// Argument flags whose values are credentials and must never be logged.
    const SECRET_FLAGS: &'static [&'static str] = &["--deepgram-api-key"];

    /// Returns a copy of `args` with secret flag values replaced by "[REDACTED]".
    fn redact_args(args: &[String]) -> Vec<String> {
        let mut out = Vec::with_capacity(args.len());
        let mut redact_next = false;
        for arg in args {
            if redact_next {
                out.push("[REDACTED]".to_string());
                redact_next = false;
                continue;
            }
            redact_next = Self::SECRET_FLAGS.iter().any(|f| arg == *f);
            out.push(arg.clone());
        }
        out
    }

    pub fn new() -> Self {
        Self {
            config: ScreenpipeConfig::default(),
            process: None,
            binary_path: None,
            last_command: None,
            captured_output: Arc::new(TokioMutex::new(OutputBuffer::new(8192))),
        }
    }

    pub fn config(&self) -> &ScreenpipeConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: ScreenpipeConfig) {
        self.config = config;
    }

    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }

    /// Find the screenpipe binary on the system
    pub fn find_binary(&mut self) -> Option<String> {
        if let Some(ref path) = self.config.binary_path {
            if std::path::Path::new(path).exists() {
                self.binary_path = Some(path.clone());
                return Some(path.clone());
            }
        }

        // Check PATH using platform-appropriate command
        let (lookup_cmd, candidates): (&str, &[&str]) = if cfg!(windows) {
            ("where", &["screenpipe", "screenpipe.exe"])
        } else {
            ("which", &["screenpipe"])
        };

        for candidate in candidates {
            if let Ok(output) = std::process::Command::new(lookup_cmd)
                .arg(candidate)
                .output()
            {
                if output.status.success() {
                    // `where` on Windows can return multiple lines; take the first
                    let path = String::from_utf8_lossy(&output.stdout)
                        .lines().next().unwrap_or("").trim().to_string();
                    if !path.is_empty() {
                        self.binary_path = Some(path.clone());
                        return Some(path);
                    }
                }
            }
        }

        // Check home directory paths
        if let Some(home) = dirs_next_home() {
            let sep = std::path::MAIN_SEPARATOR;
            let paths = [
                format!("{home}{sep}.screenpipe{sep}bin{sep}screenpipe"),
                format!("{home}{sep}.screenpipe{sep}bin{sep}screenpipe.exe"),
                format!("{home}{sep}.local{sep}bin{sep}screenpipe"),
                format!("{home}{sep}screenpipe{sep}bin{sep}screenpipe"),
                format!("{home}{sep}screenpipe{sep}bin{sep}screenpipe.exe"),
            ];
            for p in &paths {
                if std::path::Path::new(p).exists() {
                    self.binary_path = Some(p.clone());
                    return Some(p.clone());
                }
            }
        }

        None
    }

    /// Spawn a background task that reads from a pipe and appends to the shared buffer.
    fn spawn_pipe_reader<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
        pipe: R,
        buffer: Arc<TokioMutex<OutputBuffer>>,
    ) {
        use tokio::io::AsyncBufReadExt;
        tokio::spawn(async move {
            let reader = tokio::io::BufReader::new(pipe);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("[screenpipe] {}", line);
                let mut buf = buffer.lock().await;
                buf.push(&line);
                buf.push("\n");
            }
        });
    }

    /// Start the screenpipe process
    pub async fn start(&mut self) -> Result<(), AppError> {
        if self.process.is_some() {
            return Err(AppError::Screenpipe("Already running".to_string()));
        }

        let binary = self.binary_path.clone()
            .or_else(|| self.find_binary())
            .ok_or_else(|| AppError::Screenpipe(
                "Screenpipe binary not found. Install screenpipe or set the path in settings.".to_string()
            ))?;

        let args = self.config.to_args();
        let cmd_str = format!("{} {}", binary, Self::redact_args(&args).join(" "));
        log::info!("Starting screenpipe: {}", cmd_str);

        // Clear previous output
        {
            let mut buf = self.captured_output.lock().await;
            *buf = OutputBuffer::new(8192);
        }

        let mut child = Command::new(&binary)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| AppError::Screenpipe(format!("Failed to start: {}", e)))?;

        // Spawn background readers so pipes never fill up and block the process
        if let Some(stdout) = child.stdout.take() {
            Self::spawn_pipe_reader(stdout, self.captured_output.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            Self::spawn_pipe_reader(stderr, self.captured_output.clone());
        }

        self.last_command = Some(cmd_str.clone());
        self.process = Some(child);

        // Wait briefly to detect immediate crashes (bad args, port conflict, etc.)
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        if let Some(ref mut child) = self.process {
            if let Ok(Some(exit_status)) = child.try_wait() {
                self.process = None;
                // Give readers a moment to flush
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                let buf = self.captured_output.lock().await;
                let error_detail = buf.error_summary();
                let message = if error_detail.is_empty() {
                    format!("Screenpipe exited immediately with {}", exit_status)
                } else {
                    format!("Screenpipe failed: {}", error_detail)
                };
                log::warn!("Screenpipe early exit: {} | cmd: {} | full output: {}", exit_status, cmd_str, buf.text());
                return Err(AppError::Screenpipe(message));
            }
        }

        Ok(())
    }

    /// Stop the screenpipe process
    pub async fn stop(&mut self) -> Result<(), AppError> {
        if let Some(mut child) = self.process.take() {
            child.kill().await.map_err(|e| {
                AppError::Screenpipe(format!("Failed to stop: {}", e))
            })?;
            log::info!("Screenpipe stopped");
        }
        Ok(())
    }

    /// Check screenpipe health via HTTP API
    pub async fn check_health(&mut self) -> ScreenpipeStatus {
        // Check if the child process has exited
        if let Some(ref mut child) = self.process {
            match child.try_wait() {
                Ok(Some(exit_status)) => {
                    let cmd = self.last_command.as_deref().unwrap_or("unknown");
                    // Give pipe readers a moment to flush remaining output
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    let buf = self.captured_output.lock().await;
                    let error_detail = buf.error_summary();
                    let message = if error_detail.is_empty() {
                        format!("Screenpipe exited with {}", exit_status)
                    } else {
                        format!("Screenpipe: {}", error_detail)
                    };
                    log::warn!(
                        "Screenpipe exited: {} | cmd: {} | output: {}",
                        exit_status,
                        cmd,
                        buf.text()
                    );
                    self.process = None;                    return ScreenpipeStatus {
                        running: false,
                        healthy: false,
                        version: None,
                        message,
                    };
                }
                Ok(None) => {} // still running
                Err(e) => {
                    log::error!("Failed to check process status: {}", e);
                }
            }
        }

        let running = self.process.is_some();
        let url = format!("{}/health", self.config.base_url());
        match reqwest::get(&url).await {
            Ok(resp) if resp.status().is_success() => {
                let health: HealthResponse = resp.json().await.unwrap_or(HealthResponse {
                    status: None,
                    version: None,
                });
                ScreenpipeStatus {
                    running,
                    healthy: true,
                    version: health.version,
                    message: "Connected".to_string(),
                }
            }
            Ok(resp) => ScreenpipeStatus {
                running,
                healthy: false,
                version: None,
                message: format!("HTTP {}", resp.status()),
            },
            Err(e) => ScreenpipeStatus {
                running,
                healthy: false,
                version: None,
                message: format!("Connection failed: {}", e),
            },
        }
    }

    /// List available audio devices via screenpipe API
    pub async fn get_audio_devices(&self) -> Result<Vec<AudioDevice>, AppError> {
        let url = format!("{}/audio/list", self.config.base_url());
        let resp = reqwest::get(&url).await
            .map_err(|e| AppError::Screenpipe(format!("Failed to list devices: {}", e)))?;

        if !resp.status().is_success() {
            return Err(AppError::Screenpipe(format!("HTTP {}", resp.status())));
        }

        // Screenpipe returns a list of device names
        let devices: Vec<serde_json::Value> = resp.json().await
            .map_err(|e| AppError::Screenpipe(format!("Failed to parse devices: {}", e)))?;

        Ok(devices.iter().filter_map(|d| {
            d.as_str().map(|name| AudioDevice {
                name: name.to_string(),
                is_default: false,
            }).or_else(|| {
                d.get("name").and_then(|n| n.as_str()).map(|name| AudioDevice {
                    name: name.to_string(),
                    is_default: d.get("is_default").and_then(|v| v.as_bool()).unwrap_or(false),
                })
            })
        }).collect())
    }
}

fn dirs_next_home() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}
