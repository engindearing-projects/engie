use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct TerminalProvider;

impl TerminalProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for TerminalProvider {
    fn id(&self) -> &str {
        "terminal"
    }

    fn name(&self) -> &str {
        "Terminal Automation"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "terminal_list_sessions".into(),
                description: "List available terminal sessions. Returns tmux sessions if tmux is running, otherwise Terminal.app windows.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "terminal_send_keys".into(),
                description: "Send keystrokes to a terminal session. For tmux, use session:window.pane format. For Terminal.app, use window index.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "target": {
                            "type": "string",
                            "description": "Target session/pane (e.g. \"main:0.0\" for tmux, \"1\" for Terminal.app window index)"
                        },
                        "keys": {
                            "type": "string",
                            "description": "Keys to send (text or tmux key names like \"Enter\", \"C-c\")"
                        },
                        "literal": {
                            "type": "boolean",
                            "description": "Send as literal text instead of interpreting key names (default: false)"
                        }
                    },
                    "required": ["target", "keys"]
                }),
            },
            Tool {
                name: "terminal_capture".into(),
                description: "Capture the current content of a terminal session's buffer.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "target": {
                            "type": "string",
                            "description": "Target session/pane (e.g. \"main:0.0\" for tmux, \"1\" for Terminal.app window index)"
                        },
                        "lines": {
                            "type": "number",
                            "description": "Number of lines to capture from the bottom (default: 50)"
                        }
                    },
                    "required": ["target"]
                }),
            },
            Tool {
                name: "terminal_create".into(),
                description: "Create a new terminal session. Creates a tmux session if tmux is available, otherwise opens a new Terminal.app window.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Session name (for tmux) or window title"
                        },
                        "command": {
                            "type": "string",
                            "description": "Optional command to run in the new session"
                        },
                        "directory": {
                            "type": "string",
                            "description": "Working directory for the new session"
                        }
                    },
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "terminal_list_sessions" => Some(terminal_list_sessions()),
            "terminal_send_keys" => {
                let target = arguments["target"].as_str().unwrap_or("");
                let keys = arguments["keys"].as_str().unwrap_or("");
                let literal = arguments["literal"].as_bool().unwrap_or(false);
                Some(terminal_send_keys(target, keys, literal))
            }
            "terminal_capture" => {
                let target = arguments["target"].as_str().unwrap_or("");
                let lines = arguments["lines"].as_u64().unwrap_or(50) as usize;
                Some(terminal_capture(target, lines))
            }
            "terminal_create" => {
                let name = arguments["name"].as_str();
                let command = arguments["command"].as_str();
                let directory = arguments["directory"].as_str();
                Some(terminal_create(name, command, directory))
            }
            _ => None,
        }
    }
}

// ── Platform dispatch ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn terminal_list_sessions() -> CallToolResult {
    crate::platform::macos::terminal::list_sessions()
}

#[cfg(target_os = "macos")]
fn terminal_send_keys(target: &str, keys: &str, literal: bool) -> CallToolResult {
    crate::platform::macos::terminal::send_keys(target, keys, literal)
}

#[cfg(target_os = "macos")]
fn terminal_capture(target: &str, lines: usize) -> CallToolResult {
    crate::platform::macos::terminal::capture(target, lines)
}

#[cfg(target_os = "macos")]
fn terminal_create(name: Option<&str>, command: Option<&str>, directory: Option<&str>) -> CallToolResult {
    crate::platform::macos::terminal::create_session(name, command, directory)
}

#[cfg(not(target_os = "macos"))]
fn terminal_list_sessions() -> CallToolResult {
    CallToolResult::error("Terminal automation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn terminal_send_keys(_target: &str, _keys: &str, _literal: bool) -> CallToolResult {
    CallToolResult::error("Terminal automation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn terminal_capture(_target: &str, _lines: usize) -> CallToolResult {
    CallToolResult::error("Terminal automation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn terminal_create(_name: Option<&str>, _command: Option<&str>, _directory: Option<&str>) -> CallToolResult {
    CallToolResult::error("Terminal automation not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(TerminalProvider::new())
}
