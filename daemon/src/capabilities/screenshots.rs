use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct ScreenshotsProvider;

impl ScreenshotsProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for ScreenshotsProvider {
    fn id(&self) -> &str {
        "screenshots"
    }

    fn name(&self) -> &str {
        "Screenshots"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "screenshot_screen".into(),
                description: "Capture a screenshot of the full screen. Returns the image as base64-encoded PNG.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "display_id": {
                            "type": "number",
                            "description": "Optional display number to capture (1-based). Omit to capture the main display."
                        }
                    },
                }),
            },
            Tool {
                name: "screenshot_window".into(),
                description: "Capture a screenshot of a specific window by its window ID. Returns the image as base64-encoded PNG.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "window_id": {
                            "type": "number",
                            "description": "The CGWindowID of the window to capture."
                        }
                    },
                    "required": ["window_id"]
                }),
            },
            Tool {
                name: "screenshot_region".into(),
                description: "Capture a screenshot of a rectangular region of the screen. Returns the image as base64-encoded PNG.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number",
                            "description": "X coordinate of the top-left corner."
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate of the top-left corner."
                        },
                        "width": {
                            "type": "number",
                            "description": "Width of the region in pixels."
                        },
                        "height": {
                            "type": "number",
                            "description": "Height of the region in pixels."
                        }
                    },
                    "required": ["x", "y", "width", "height"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "screenshot_screen" => {
                let display_id = arguments["display_id"].as_u64().map(|v| v as u32);
                Some(screenshot_screen(display_id))
            }
            "screenshot_window" => {
                let window_id = match arguments["window_id"].as_u64() {
                    Some(id) => id as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: window_id")),
                };
                Some(screenshot_window(window_id))
            }
            "screenshot_region" => {
                let x = match arguments["x"].as_i64() {
                    Some(v) => v as i32,
                    None => return Some(CallToolResult::error("Missing required parameter: x")),
                };
                let y = match arguments["y"].as_i64() {
                    Some(v) => v as i32,
                    None => return Some(CallToolResult::error("Missing required parameter: y")),
                };
                let width = match arguments["width"].as_u64() {
                    Some(v) => v as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: width")),
                };
                let height = match arguments["height"].as_u64() {
                    Some(v) => v as u32,
                    None => return Some(CallToolResult::error("Missing required parameter: height")),
                };
                Some(screenshot_region(x, y, width, height))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn screenshot_screen(display_id: Option<u32>) -> CallToolResult {
    crate::platform::macos::screenshots::capture_screen(display_id)
}

#[cfg(target_os = "macos")]
fn screenshot_window(window_id: u32) -> CallToolResult {
    crate::platform::macos::screenshots::capture_window(window_id)
}

#[cfg(target_os = "macos")]
fn screenshot_region(x: i32, y: i32, width: u32, height: u32) -> CallToolResult {
    crate::platform::macos::screenshots::capture_region(x, y, width, height)
}

#[cfg(not(target_os = "macos"))]
fn screenshot_screen(_display_id: Option<u32>) -> CallToolResult {
    CallToolResult::error("Screenshots not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn screenshot_window(_window_id: u32) -> CallToolResult {
    CallToolResult::error("Screenshots not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn screenshot_region(_x: i32, _y: i32, _width: u32, _height: u32) -> CallToolResult {
    CallToolResult::error("Screenshots not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(ScreenshotsProvider::new())
}
