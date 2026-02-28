use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
pub struct FamiliarConfig {
    #[serde(default)]
    pub identity: Identity,
    #[serde(default)]
    pub gateway: Gateway,
}

#[derive(Debug, Deserialize)]
pub struct Identity {
    #[serde(default = "default_name")]
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct Gateway {
    #[serde(default = "default_gateway_url")]
    pub url: String,
    pub token: Option<String>,
}

fn default_name() -> String {
    "Familiar".into()
}

fn default_gateway_url() -> String {
    "ws://localhost:18789".into()
}

impl Default for Identity {
    fn default() -> Self {
        Self {
            name: default_name(),
        }
    }
}

impl Default for Gateway {
    fn default() -> Self {
        Self {
            url: default_gateway_url(),
            token: None,
        }
    }
}

impl Default for FamiliarConfig {
    fn default() -> Self {
        Self {
            identity: Identity::default(),
            gateway: Gateway::default(),
        }
    }
}

impl FamiliarConfig {
    /// Resolve the gateway token.
    /// Search order: config file field > standalone token file > env vars > None
    pub fn gateway_token(&self) -> Option<String> {
        // 1. Config file field
        if let Some(ref t) = self.gateway.token {
            return Some(t.clone());
        }
        // 2. Standalone token file (~/.familiar/gateway.token)
        if let Some(home) = dirs::home_dir() {
            let token_file = home.join(".familiar/gateway.token");
            if let Ok(t) = std::fs::read_to_string(&token_file) {
                let trimmed = t.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
        // 3. Env vars
        if let Ok(t) = std::env::var("FAMILIAR_GATEWAY_TOKEN") {
            return Some(t);
        }
        if let Ok(t) = std::env::var("COZYTERM_GATEWAY_TOKEN") {
            return Some(t);
        }
        None
    }
}

/// Load the familiar config file.
/// Search order:
///   1. FAMILIAR_CONFIG env var
///   2. ~/.familiar/config.toml
///   3. Default values
pub fn load() -> FamiliarConfig {
    let candidates = [
        std::env::var("FAMILIAR_CONFIG").ok().map(PathBuf::from),
        dirs::home_dir().map(|h| h.join(".familiar/config.toml")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            match fs::read_to_string(&candidate) {
                Ok(content) => match toml::from_str::<FamiliarConfig>(&content) {
                    Ok(config) => {
                        info!(
                            path = %candidate.display(),
                            name = %config.identity.name,
                            "loaded familiar config"
                        );
                        return config;
                    }
                    Err(e) => {
                        warn!(path = %candidate.display(), error = %e, "failed to parse config");
                    }
                },
                Err(e) => {
                    warn!(path = %candidate.display(), error = %e, "failed to read config");
                }
            }
        }
    }

    info!("no config file found, using defaults");
    FamiliarConfig::default()
}
