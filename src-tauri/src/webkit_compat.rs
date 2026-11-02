//! Linux preflight for the WebKitGTK 2.54.0/2.54.1 Wayland regression.
//!
//! Fedora 44 shipped `webkit2gtk4.1` 2.54.0/2.54.1, which aborts with
//! `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.` on
//! NVIDIA + Wayland before Tauri can show a window (WebKit bug 324551, fixed
//! in 2.54.2). Detect that combination before the WebView is created, explain
//! the update, and let the user start in compatibility mode instead of the
//! window silently disappearing.
//!
//! `PRMPTR_WEBKIT_COMPAT=1` forces compatibility mode; `=0` skips the check.

/// Is this WebKitGTK version the affected one on this session?
///
/// Only 2.54.0 and 2.54.1 carry the regression. 2.54.2 and newer are fixed;
/// older series (2.52, ...) never had it. NVIDIA + Wayland is the reported
/// combination, and restricting the fallback to it avoids disabling the
/// DMA-BUF renderer for unrelated drivers.
pub fn is_affected(version: Option<(u32, u32, u32)>, wayland: bool, nvidia: bool) -> bool {
    matches!(version, Some((2, 54, micro)) if micro < 2) && wayland && nvidia
}

#[cfg(target_os = "linux")]
pub fn preflight() {
    use std::path::Path;
    use std::process::Command;

    extern "C" {
        fn webkit_get_major_version() -> u32;
        fn webkit_get_minor_version() -> u32;
        fn webkit_get_micro_version() -> u32;
    }

    // Respect an explicit choice and an override already in the environment.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let forced = std::env::var("PRMPTR_WEBKIT_COMPAT").ok();

    // SAFETY: these functions are part of libwebkit2gtk, which Tauri links.
    let version = unsafe {
        Some((
            webkit_get_major_version(),
            webkit_get_minor_version(),
            webkit_get_micro_version(),
        ))
    };
    let wayland = std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let nvidia = Path::new("/proc/driver/nvidia/version").exists()
        || std::fs::read_to_string("/proc/modules")
            .map(|modules| modules.lines().any(|line| line.starts_with("nvidia ")))
            .unwrap_or(false);

    if !is_affected(version, wayland, nvidia) {
        return;
    }
    let (major, minor, micro) = version.expect("checked above");
    log::warn!(
        "WebKitGTK {major}.{minor}.{micro} has a Wayland/NVIDIA rendering bug; \
         update webkit2gtk4.1 (Fedora 44: 2.54.2-1.fc44 or newer)"
    );

    let enable = match forced.as_deref() {
        Some("1") => true,
        Some("0") => {
            log::warn!("PRMPTR_WEBKIT_COMPAT=0: leaving the DMA-BUF renderer enabled");
            false
        }
        _ => match ask_compat_dialog() {
            Some(true) => true,
            Some(false) => {
                log::error!("start cancelled until WebKitGTK is updated");
                std::process::exit(1);
            }
            None => {
                log::warn!(
                    "no kdialog/zenity found; starting with the DMA-BUF renderer disabled \
                     (set PRMPTR_WEBKIT_COMPAT=0 to opt out)"
                );
                true
            }
        },
    };

    if enable {
        // SAFETY: called before Tauri starts any threads that read the env.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        log::warn!("compatibility mode: WEBKIT_DISABLE_DMABUF_RENDERER=1");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn preflight() {}

/// Ask the user to start in compatibility mode. Returns `Some(true)` to start
/// with the fallback, `Some(false)` to cancel, or `None` when no dialog tool is
/// available.
#[cfg(target_os = "linux")]
fn ask_compat_dialog() -> Option<bool> {
    use std::process::Command;

    const MESSAGE: &str = "PRMPTR needs a newer WebKitGTK to render on Wayland with NVIDIA.\n\n\
        Installed: WebKitGTK 2.54.0/2.54.1. Fedora 44 provides 2.54.2 with the fix.\n\n\
        Update: sudo dnf upgrade webkit2gtk4.1 javascriptcoregtk4.1\n\n\
        Start PRMPTR now in compatibility mode?";

    if let Ok(status) = Command::new("kdialog")
        .args(["--title", "PRMPTR", "--yesno", MESSAGE])
        .status()
    {
        match status.code() {
            Some(0) => return Some(true),
            Some(1) => return Some(false),
            _ => {}
        }
    }

    let text = format!("--text={MESSAGE}");
    if let Ok(status) = Command::new("zenity")
        .args(["--title=PRMPTR", "--question", &text])
        .status()
    {
        match status.code() {
            Some(0) => return Some(true),
            Some(1) => return Some(false),
            _ => {}
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::is_affected;

    #[test]
    fn flags_only_the_affected_wayland_nvidia_combination() {
        assert!(is_affected(Some((2, 54, 0)), true, true));
        assert!(is_affected(Some((2, 54, 1)), true, true));
        assert!(!is_affected(Some((2, 54, 2)), true, true), "fixed in 2.54.2");
        assert!(!is_affected(Some((2, 52, 4)), true, true), "older releases had no regression");
        assert!(!is_affected(Some((2, 54, 1)), false, true), "X11 is unaffected");
        assert!(!is_affected(Some((2, 54, 1)), true, false), "known bug is NVIDIA-specific");
        assert!(!is_affected(None, true, true));
    }
}
