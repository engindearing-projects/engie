use serde_json::{json, Value};

use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct AppControlProvider;

impl AppControlProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for AppControlProvider {
    fn id(&self) -> &str {
        "app_control"
    }

    fn name(&self) -> &str {
        "App Control"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "app_list".into(),
                description: "List all running GUI applications with name, PID, bundle ID, and frontmost status.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "app_launch".into(),
                description: "Launch an application by name (e.g. 'Safari', 'Terminal').".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Application name to launch"
                        }
                    },
                    "required": ["name"]
                }),
            },
            Tool {
                name: "app_quit".into(),
                description: "Quit a running application by name. Use force=true to kill immediately.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Application name to quit"
                        },
                        "force": {
                            "type": "boolean",
                            "description": "Force kill the application (default: false)"
                        }
                    },
                    "required": ["name"]
                }),
            },
            Tool {
                name: "app_info".into(),
                description: "Get detailed info for a specific running application by name.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Application name to get info for"
                        }
                    },
                    "required": ["name"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "app_list" => Some(app_list()),
            "app_launch" => {
                let name = arguments["name"].as_str().unwrap_or("");
                if name.is_empty() {
                    return Some(CallToolResult::error("Missing required parameter: name"));
                }
                Some(app_launch(name))
            }
            "app_quit" => {
                let name = arguments["name"].as_str().unwrap_or("");
                if name.is_empty() {
                    return Some(CallToolResult::error("Missing required parameter: name"));
                }
                let force = arguments["force"].as_bool().unwrap_or(false);
                Some(app_quit(name, force))
            }
            "app_info" => {
                let name = arguments["name"].as_str().unwrap_or("");
                if name.is_empty() {
                    return Some(CallToolResult::error("Missing required parameter: name"));
                }
                Some(app_info(name))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn app_list() -> CallToolResult {
    crate::platform::macos::app_control::list_apps()
}

#[cfg(target_os = "macos")]
fn app_launch(name: &str) -> CallToolResult {
    crate::platform::macos::app_control::launch_app(name)
}

#[cfg(target_os = "macos")]
fn app_quit(name: &str, force: bool) -> CallToolResult {
    crate::platform::macos::app_control::quit_app(name, force)
}

#[cfg(target_os = "macos")]
fn app_info(name: &str) -> CallToolResult {
    crate::platform::macos::app_control::app_info(name)
}

#[cfg(not(target_os = "macos"))]
fn app_list() -> CallToolResult {
    CallToolResult::error("App control not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn app_launch(_name: &str) -> CallToolResult {
    CallToolResult::error("App control not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn app_quit(_name: &str, _force: bool) -> CallToolResult {
    CallToolResult::error("App control not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn app_info(_name: &str) -> CallToolResult {
    CallToolResult::error("App control not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(AppControlProvider::new())
}
