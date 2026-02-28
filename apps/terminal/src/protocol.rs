use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Outgoing request to the gateway.
#[derive(Debug, Serialize)]
pub struct GatewayRequest {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub id: String,
    pub method: String,
    pub params: Value,
}

/// Incoming message from the gateway (loosely typed for flexibility).
#[derive(Debug, Deserialize)]
pub struct GatewayMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub ok: Option<bool>,
    #[serde(default)]
    pub event: Option<String>,
    #[serde(default)]
    pub payload: Option<Value>,
    #[serde(default)]
    pub error: Option<Value>,
}

/// Parsed gateway events for the app layer.
#[derive(Debug, Clone)]
pub enum GatewayEvent {
    Connected,
    Disconnected,
    StreamDelta { text: String },
    ToolStart { name: String, label: String },
    ToolEnd,
    ChatFinal { content: String },
    ChatError { message: String },
    Status { text: String },
}

/// Map tool names to friendly labels.
pub fn tool_label(name: &str) -> String {
    match name {
        "Read" => "Reading".into(),
        "Grep" => "Searching".into(),
        "Glob" => "Finding files".into(),
        "Bash" => "Running command".into(),
        "Edit" => "Editing".into(),
        "Write" => "Writing".into(),
        "WebFetch" => "Fetching URL".into(),
        "WebSearch" => "Searching web".into(),
        _ => {
            // MCP tool prefix matching
            if name.contains("jira") {
                return "Searching Jira".into();
            }
            if name.contains("slack") {
                return "Posting to Slack".into();
            }
            if name.contains("figma") {
                return "Getting Figma screenshot".into();
            }
            // Fallback: strip mcp prefix, humanize
            let cleaned = name
                .trim_start_matches("mcp__")
                .split("__")
                .last()
                .unwrap_or(name)
                .replace('_', " ");
            let mut chars = cleaned.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                None => name.to_string(),
            }
        }
    }
}
