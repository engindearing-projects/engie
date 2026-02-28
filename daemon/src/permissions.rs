use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Debug, Deserialize, Serialize)]
pub struct PermissionsConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub capabilities: HashMap<String, CapabilityPermission>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CapabilityPermission {
    pub allowed: bool,
    #[serde(default)]
    pub tools: HashMap<String, bool>,
}

impl PermissionsConfig {
    /// Check if a specific tool is allowed.
    /// Deny by default if capability or tool not configured.
    pub fn is_tool_allowed(&self, capability_id: &str, tool_name: &str) -> bool {
        match self.capabilities.get(capability_id) {
            None => false,
            Some(cap) => cap.tools.get(tool_name).copied().unwrap_or(cap.allowed),
        }
    }

    /// Check if an entire capability is allowed.
    pub fn is_capability_allowed(&self, capability_id: &str) -> bool {
        self.capabilities
            .get(capability_id)
            .is_some_and(|cap| cap.allowed)
    }
}

impl Default for PermissionsConfig {
    fn default() -> Self {
        Self {
            version: 1,
            capabilities: HashMap::new(),
        }
    }
}

/// Find and load the permissions config file.
/// Search order:
///   1. FAMILIAR_DAEMON_CONFIG env var
///   2. ~/.familiar/daemon/permissions.toml
///   3. ./config/permissions.toml (dev fallback)
/// If no file is found, return default (deny-all).
pub fn load() -> PermissionsConfig {
    let candidates = [
        std::env::var("FAMILIAR_DAEMON_CONFIG")
            .ok()
            .map(PathBuf::from),
        dirs::home_dir().map(|h| h.join(".familiar/daemon/permissions.toml")),
        Some(PathBuf::from("config/permissions.toml")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            match fs::read_to_string(&candidate) {
                Ok(content) => match toml::from_str::<PermissionsConfig>(&content) {
                    Ok(config) => {
                        info!(
                            path = %candidate.display(),
                            capabilities = config.capabilities.len(),
                            "loaded permissions"
                        );
                        return config;
                    }
                    Err(e) => {
                        warn!(path = %candidate.display(), error = %e, "failed to parse permissions");
                    }
                },
                Err(e) => {
                    warn!(path = %candidate.display(), error = %e, "failed to read permissions");
                }
            }
        }
    }

    info!("no permissions file found, using deny-all defaults");
    PermissionsConfig::default()
}
