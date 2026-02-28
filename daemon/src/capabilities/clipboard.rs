use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct ClipboardProvider;

impl ClipboardProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for ClipboardProvider {
    fn id(&self) -> &str {
        "clipboard"
    }

    fn name(&self) -> &str {
        "Clipboard"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "clipboard_read".into(),
                description: "Read the current clipboard contents (text only).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "clipboard_write".into(),
                description: "Write text to the clipboard.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Text to write to the clipboard"
                        }
                    },
                    "required": ["text"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "clipboard_read" => Some(clipboard_read()),
            "clipboard_write" => {
                let text = arguments["text"].as_str().unwrap_or("");
                Some(clipboard_write(text))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn clipboard_read() -> CallToolResult {
    crate::platform::macos::clipboard::read()
}

#[cfg(target_os = "macos")]
fn clipboard_write(text: &str) -> CallToolResult {
    crate::platform::macos::clipboard::write(text)
}

#[cfg(not(target_os = "macos"))]
fn clipboard_read() -> CallToolResult {
    CallToolResult::error("Clipboard not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn clipboard_write(_text: &str) -> CallToolResult {
    CallToolResult::error("Clipboard not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(ClipboardProvider::new())
}
