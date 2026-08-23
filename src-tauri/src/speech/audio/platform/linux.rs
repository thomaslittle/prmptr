use cpal::traits::{DeviceTrait, HostTrait};

pub fn backend_name() -> &'static str {
    "pipewire-pulse-monitor"
}

fn default_sink_monitor_name() -> Option<String> {
    let output = std::process::Command::new("pactl")
        .args(["get-default-sink"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sink = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sink.is_empty() {
        None
    } else {
        Some(format!("{sink}.monitor"))
    }
}

fn monitor_names_from_pactl() -> Vec<String> {
    let Ok(output) = std::process::Command::new("pactl")
        .args(["list", "short", "sources"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let _index = fields.next()?;
            let name = fields.next()?.trim();
            name.ends_with(".monitor").then(|| name.to_string())
        })
        .collect()
}

fn cpal_monitor_device(host: &cpal::Host, preferred: Option<&str>) -> Option<cpal::Device> {
    let devices: Vec<cpal::Device> = host.input_devices().ok()?.collect();
    if let Some(name) = preferred {
        if let Some(index) = devices.iter().position(|device| super::device_matches(device, name)) {
            return devices.into_iter().nth(index);
        }
    }

    let pactl_names = monitor_names_from_pactl();
    for monitor in pactl_names {
        if let Some(index) = devices
            .iter()
            .position(|device| super::device_matches(device, &monitor))
        {
            return devices.into_iter().nth(index);
        }
    }

    devices
        .into_iter()
        .find(|device| {
            device
                .name()
                .map(|name| name.to_lowercase().contains("monitor"))
                .unwrap_or(false)
        })
}

pub fn supports_system_capture() -> bool {
    let host = cpal::default_host();
    cpal_monitor_device(&host, default_sink_monitor_name().as_deref()).is_some()
}

pub fn system_capture_detail() -> &'static str {
    "System output uses a PipeWire/PulseAudio monitor source discovered through pactl/CPAL."
}

pub fn resolve_system_device(host: &cpal::Host, _requested: Option<&str>) -> Option<cpal::Device> {
    cpal_monitor_device(host, default_sink_monitor_name().as_deref())
}

pub fn system_capture_uses_input_config() -> bool {
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn monitor_source_parser_only_accepts_monitor_names() {
        let sample = "12\talsa_input.foo\tmodule\n13\talsa_output.bar.monitor\tmodule\n";
        let names: Vec<_> = sample
            .lines()
            .filter_map(|line| {
                let mut fields = line.split('\t');
                let _ = fields.next()?;
                let name = fields.next()?;
                name.ends_with(".monitor").then(|| name.to_string())
            })
            .collect();
        assert_eq!(names, vec!["alsa_output.bar.monitor"]);
    }
}
