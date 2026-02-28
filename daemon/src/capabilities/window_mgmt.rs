use serde_json::{json, Value};

use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct WindowMgmtProvider;

impl WindowMgmtProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for WindowMgmtProvider {
    fn id(&self) -> &str {
        "window_mgmt"
    }

    fn name(&self) -> &str {
        "Window Management"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "window_list".into(),
                description: "List on-screen windows with ID, app name, title, position, and size. Optionally filter by app name.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "app_name": {
                            "type": "string",
                            "description": "Filter windows by application name (case-insensitive substring match)"
                        }
                    },
                }),
            },
            Tool {
                name: "window_focus".into(),
                description: "Focus (bring to front) a window by its window ID.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The window ID to focus"
                        }
                    },
                    "required": ["window_id"]
                }),
            },
            Tool {
                name: "window_move".into(),
                description: "Move a window to a new screen position (x, y).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The window ID to move"
                        },
                        "x": {
                            "type": "number",
                            "description": "New X position (pixels from left)"
                        },
                        "y": {
                            "type": "number",
                            "description": "New Y position (pixels from top)"
                        }
                    },
                    "required": ["window_id", "x", "y"]
                }),
            },
            Tool {
                name: "window_resize".into(),
                description: "Resize a window to a new width and height.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The window ID to resize"
                        },
                        "width": {
                            "type": "number",
                            "description": "New width in pixels"
                        },
                        "height": {
                            "type": "number",
                            "description": "New height in pixels"
                        }
                    },
                    "required": ["window_id", "width", "height"]
                }),
            },
            Tool {
                name: "window_minimize".into(),
                description: "Minimize a window to the dock.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The window ID to minimize"
                        }
                    },
                    "required": ["window_id"]
                }),
            },
            Tool {
                name: "window_close".into(),
                description: "Close a window by clicking its close button.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The window ID to close"
                        }
                    },
                    "required": ["window_id"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "window_list" => {
                let app_name = arguments["app_name"].as_str();
                Some(window_list(app_name))
            }
            "window_focus" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                Some(window_focus(window_id))
            }
            "window_move" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                let x = match arguments["x"].as_f64() {
                    Some(v) => v,
                    None => return Some(CallToolResult::error("Missing required parameter: x")),
                };
                let y = match arguments["y"].as_f64() {
                    Some(v) => v,
                    None => return Some(CallToolResult::error("Missing required parameter: y")),
                };
                Some(window_move(window_id, x, y))
            }
            "window_resize" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                let width = match arguments["width"].as_f64() {
                    Some(v) => v,
                    None => return Some(CallToolResult::error("Missing required parameter: width")),
                };
                let height = match arguments["height"].as_f64() {
                    Some(v) => v,
                    None => return Some(CallToolResult::error("Missing required parameter: height")),
                };
                Some(window_resize(window_id, width, height))
            }
            "window_minimize" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                Some(window_minimize(window_id))
            }
            "window_close" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                Some(window_close(window_id))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn window_list(app_name: Option<&str>) -> CallToolResult {
    crate::platform::macos::window_mgmt::list_windows(app_name)
}

#[cfg(target_os = "macos")]
fn window_focus(window_id: u32) -> CallToolResult {
    crate::platform::macos::window_mgmt::focus_window(window_id)
}

#[cfg(target_os = "macos")]
fn window_move(window_id: u32, x: f64, y: f64) -> CallToolResult {
    crate::platform::macos::window_mgmt::move_window(window_id, x, y)
}

#[cfg(target_os = "macos")]
fn window_resize(window_id: u32, width: f64, height: f64) -> CallToolResult {
    crate::platform::macos::window_mgmt::resize_window(window_id, width, height)
}

#[cfg(target_os = "macos")]
fn window_minimize(window_id: u32) -> CallToolResult {
    crate::platform::macos::window_mgmt::minimize_window(window_id)
}

#[cfg(target_os = "macos")]
fn window_close(window_id: u32) -> CallToolResult {
    crate::platform::macos::window_mgmt::close_window(window_id)
}

#[cfg(not(target_os = "macos"))]
fn window_list(_app_name: Option<&str>) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn window_focus(_window_id: u32) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn window_move(_window_id: u32, _x: f64, _y: f64) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn window_resize(_window_id: u32, _width: f64, _height: f64) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn window_minimize(_window_id: u32) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn window_close(_window_id: u32) -> CallToolResult {
    CallToolResult::error("Window management not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(WindowMgmtProvider::new())
}
