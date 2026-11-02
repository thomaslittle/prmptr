//! Diagnostic: print what "Your AI apps" (OriginLM) discovers and probes here,
//! including the rows the model picker would receive.
//!
//!     cargo run --example probe_local_ai
//!
//! Read-only: the same passive scan the model picker runs.

use originlm_kit::{ClientPolicy, Kit};
use prmptr_lib::local_ai::{inventory_source, models_from_snapshot};
use serde_json::Value;
use std::collections::BTreeMap;

const PROVIDERS: &[&str] = &[
    "claude_code",
    "codex",
    "opencode",
    "gemini_cli",
    "grok",
    "antigravity",
    "copilot",
    "cursor",
    "ollama",
    "lmstudio",
];

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data = std::env::temp_dir().join("prmptr-probe-originlm");
    std::fs::create_dir_all(&data)?;
    let kit = Kit::builder()
        .state_dir(data)
        .inventory(inventory_source())
        .execution(true)
        .build()?;
    let policy = ClientPolicy {
        allow_passive_discovery: true,
        connection_ids: None,
        probe_provider_ids: PROVIDERS.iter().map(|p| p.to_string()).collect(),
        ..ClientPolicy::passive()
    };
    let client = kit.connect("prmptr-probe", policy)?;

    let scanned = client.scan().await?;
    let value = serde_json::to_value(&scanned)?;
    println!("== connections after scan ==");
    for c in value["connections"].as_array().into_iter().flatten() {
        println!(
            "{} | {} | auth={}",
            c["providerId"].as_str().unwrap_or("?"),
            c["displayName"].as_str().unwrap_or("?"),
            c["auth"]["value"]
                .as_str()
                .or_else(|| c["auth"]["reason"].as_str())
                .unwrap_or("?"),
        );
    }

    let ids: Vec<String> = value["connections"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| PROVIDERS.contains(&c["providerId"].as_str().unwrap_or("")))
        .filter_map(|c| c["id"].as_str().map(str::to_string))
        .collect();
    let mut last = value;
    for id in &ids {
        match client.probe(id).await {
            Ok(snapshot) => last = serde_json::to_value(&snapshot)?,
            Err(e) => println!("PROBE ERROR {id}: {e}"),
        }
    }

    let rows = models_from_snapshot(&last);
    println!("\n== routes ==");
    for route in last["routes"].as_array().into_iter().flatten() {
        println!(
            "{} | {} | billing={}",
            route["providerId"].as_str().unwrap_or("?"),
            route["displayName"].as_str().unwrap_or("?"),
            route["billing"]["value"].as_str().unwrap_or("unknown"),
        );
    }
    println!("\n== picker rows ({}) ==", rows.len());    let mut by_app: BTreeMap<&str, usize> = BTreeMap::new();
    for row in &rows {
        *by_app.entry(row.provider_name.as_str()).or_default() += 1;
        println!(
            "{} | {} | {} (image={})",
            row.provider_name, row.name, row.native_id, row.supports_image_input
        );
    }
    println!("\nby app: {by_app:?}");
    client.close();
    Ok(())
}
