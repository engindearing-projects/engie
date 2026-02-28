use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct NotificationsProvider;

impl NotificationsProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for NotificationsProvider {
    fn id(&self) -> &str {
        "notifications"
    }

    fn name(&self) -> &str {
        "Notifications"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![Tool {
            name: "notify_send".into(),
            description: "Send a native desktop notification.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Notification title"
                    },
                    "body": {
                        "type": "string",
                        "description": "Notification body text"
                    },
                    "subtitle": {
                        "type": "string",
                        "description": "Optional subtitle (macOS only)"
                    }
                },
                "required": ["title", "body"]
            }),
        }]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "notify_send" => {
                let title = arguments["title"].as_str().unwrap_or("Familiar");
                let body = arguments["body"].as_str().unwrap_or("");
                let subtitle = arguments["subtitle"].as_str();
                Some(send_notification(title, body, subtitle))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn send_notification(title: &str, body: &str, subtitle: Option<&str>) -> CallToolResult {
    crate::platform::macos::notifications::send(title, body, subtitle)
}

#[cfg(not(target_os = "macos"))]
fn send_notification(_title: &str, _body: &str, _subtitle: Option<&str>) -> CallToolResult {
    CallToolResult::error("Notifications not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(NotificationsProvider::new())
}
