use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Debug, Deserialize)]
pub struct FamiliarConfig {
    #[allow(dead_code)]
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub identity: Identity,
}

#[derive(Debug, Deserialize)]
pub struct Identity {
    #[serde(default = "default_name")]
    pub name: String,
}

fn default_version() -> u32 {
    1
}

fn default_name() -> String {
    "familiar-daemon".into()
}

impl Default for Identity {
    fn default() -> Self {
        Self {
            name: default_name(),
        }
    }
}

impl Default for FamiliarConfig {
    fn default() -> Self {
        Self {
            version: 1,
            identity: Identity::default(),
        }
    }
}

/// Load the familiar config file.
/// Search order:
///   1. FAMILIAR_CONFIG env var
///   2. ~/.familiar/config.toml
///   3. Default (name = "familiar-daemon")
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
