use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateFile {
    pub template: TemplateData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateData {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub context: TemplateContext,
    pub defaults: TemplateDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateContext {
    pub prefill: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateDefaults {
    pub trigger_mode: String,
    pub response_style: String,
    pub auto_interval_secs: u32,
    pub temperature: f32,
}

pub fn load_templates_from_dir(dir: &Path) -> Vec<TemplateData> {
    let mut templates = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("toml") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(parsed) = toml::from_str::<TemplateFile>(&content) {
                        templates.push(parsed.template);
                    }
                }
            }
        }
    }

    templates.sort_by(|a, b| a.id.cmp(&b.id));
    templates
}
