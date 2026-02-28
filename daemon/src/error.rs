use std::fmt;

#[derive(Debug)]
pub enum DaemonError {
    Permission(String),
    Platform(String),
    NotImplemented(String),
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for DaemonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Permission(msg) => write!(f, "Permission denied: {msg}"),
            Self::Platform(msg) => write!(f, "Platform error: {msg}"),
            Self::NotImplemented(msg) => write!(f, "Not implemented: {msg}"),
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Json(e) => write!(f, "JSON error: {e}"),
        }
    }
}

impl std::error::Error for DaemonError {}

impl From<std::io::Error> for DaemonError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for DaemonError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}
