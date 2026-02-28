use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct InputSimProvider;

impl InputSimProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for InputSimProvider {
    fn id(&self) -> &str {
        "input_sim"
    }

    fn name(&self) -> &str {
        "Input Simulation"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "input_key".into(),
                description: "Simulate a key press with optional modifier keys.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "key": {
                            "type": "string",
                            "description": "Key name (e.g. \"return\", \"a\", \"f1\", \"space\", \"tab\", \"escape\", \"left\", \"up\")"
                        },
                        "modifiers": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "Optional modifier keys: \"cmd\", \"shift\", \"alt\"/\"option\", \"ctrl\"/\"control\", \"fn\""
                        }
                    },
                    "required": ["key"]
                }),
            },
            Tool {
                name: "input_type".into(),
                description: "Type a string of text. Supports Unicode characters.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Text to type"
                        },
                        "delay_ms": {
                            "type": "number",
                            "description": "Delay in milliseconds between each character (default: 0, types all at once)"
                        }
                    },
                    "required": ["text"]
                }),
            },
            Tool {
                name: "input_mouse_move".into(),
                description: "Move the mouse cursor to a screen position.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number",
                            "description": "X coordinate (pixels from left)"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate (pixels from top)"
                        }
                    },
                    "required": ["x", "y"]
                }),
            },
            Tool {
                name: "input_scroll".into(),
                description: "Scroll at a screen position. Positive delta scrolls up/right, negative scrolls down/left.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number",
                            "description": "X coordinate to scroll at"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate to scroll at"
                        },
                        "delta_y": {
                            "type": "number",
                            "description": "Vertical scroll amount (positive=up, negative=down). Default: 0"
                        },
                        "delta_x": {
                            "type": "number",
                            "description": "Horizontal scroll amount (positive=right, negative=left). Default: 0"
                        }
                    },
                    "required": ["x", "y"]
                }),
            },
            Tool {
                name: "input_drag".into(),
                description: "Drag the mouse from one position to another.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "from_x": {
                            "type": "number",
                            "description": "Starting X coordinate"
                        },
                        "from_y": {
                            "type": "number",
                            "description": "Starting Y coordinate"
                        },
                        "to_x": {
                            "type": "number",
                            "description": "Ending X coordinate"
                        },
                        "to_y": {
                            "type": "number",
                            "description": "Ending Y coordinate"
                        },
                        "button": {
                            "type": "string",
                            "description": "Mouse button: \"left\" (default), \"right\""
                        },
                        "duration_ms": {
                            "type": "number",
                            "description": "Duration of drag in milliseconds (default: 200)"
                        }
                    },
                    "required": ["from_x", "from_y", "to_x", "to_y"]
                }),
            },
            Tool {
                name: "input_hotkey".into(),
                description: "Press a keyboard shortcut. Takes a combo string like \"cmd+shift+s\" or \"ctrl+alt+delete\".".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "combo": {
                            "type": "string",
                            "description": "Key combo string separated by '+' (e.g. \"cmd+shift+s\", \"ctrl+c\", \"cmd+a\")"
                        }
                    },
                    "required": ["combo"]
                }),
            },
            Tool {
                name: "input_mouse_click".into(),
                description: "Click the mouse at a screen position.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number",
                            "description": "X coordinate (pixels from left)"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate (pixels from top)"
                        },
                        "button": {
                            "type": "string",
                            "description": "Mouse button: \"left\" (default), \"right\", or \"center\""
                        },
                        "clicks": {
                            "type": "number",
                            "description": "Number of clicks (default: 1, use 2 for double-click)"
                        }
                    },
                    "required": ["x", "y"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "input_key" => {
                let key = arguments["key"].as_str().unwrap_or("");
                let modifiers: Vec<String> = arguments["modifiers"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                Some(input_key(key, &modifiers))
            }
            "input_type" => {
                let text = arguments["text"].as_str().unwrap_or("");
                let delay_ms = arguments["delay_ms"].as_u64().unwrap_or(0);
                Some(input_type(text, delay_ms))
            }
            "input_mouse_move" => {
                let x = arguments["x"].as_f64().unwrap_or(0.0);
                let y = arguments["y"].as_f64().unwrap_or(0.0);
                Some(input_mouse_move(x, y))
            }
            "input_scroll" => {
                let x = arguments["x"].as_f64().unwrap_or(0.0);
                let y = arguments["y"].as_f64().unwrap_or(0.0);
                let delta_y = arguments["delta_y"].as_i64().unwrap_or(0) as i32;
                let delta_x = arguments["delta_x"].as_i64().unwrap_or(0) as i32;
                Some(input_scroll(x, y, delta_y, delta_x))
            }
            "input_drag" => {
                let from_x = arguments["from_x"].as_f64().unwrap_or(0.0);
                let from_y = arguments["from_y"].as_f64().unwrap_or(0.0);
                let to_x = arguments["to_x"].as_f64().unwrap_or(0.0);
                let to_y = arguments["to_y"].as_f64().unwrap_or(0.0);
                let button = arguments["button"].as_str().unwrap_or("left");
                let duration_ms = arguments["duration_ms"].as_u64().unwrap_or(200);
                Some(input_drag(from_x, from_y, to_x, to_y, button, duration_ms))
            }
            "input_hotkey" => {
                let combo = arguments["combo"].as_str().unwrap_or("");
                Some(input_hotkey(combo))
            }
            "input_mouse_click" => {
                let x = arguments["x"].as_f64().unwrap_or(0.0);
                let y = arguments["y"].as_f64().unwrap_or(0.0);
                let button = arguments["button"].as_str().unwrap_or("left");
                let clicks = arguments["clicks"].as_u64().unwrap_or(1) as u32;
                Some(input_mouse_click(x, y, button, clicks))
            }
            _ => None,
        }
    }
}

// ── Platform dispatch ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn input_key(key: &str, modifiers: &[String]) -> CallToolResult {
    crate::platform::macos::input_sim::key_press(key, modifiers)
}

#[cfg(target_os = "macos")]
fn input_type(text: &str, delay_ms: u64) -> CallToolResult {
    crate::platform::macos::input_sim::type_text(text, delay_ms)
}

#[cfg(target_os = "macos")]
fn input_mouse_move(x: f64, y: f64) -> CallToolResult {
    crate::platform::macos::input_sim::mouse_move(x, y)
}

#[cfg(target_os = "macos")]
fn input_scroll(x: f64, y: f64, delta_y: i32, delta_x: i32) -> CallToolResult {
    crate::platform::macos::input_sim::scroll(x, y, delta_y, delta_x)
}

#[cfg(target_os = "macos")]
fn input_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64, button: &str, duration_ms: u64) -> CallToolResult {
    crate::platform::macos::input_sim::drag(from_x, from_y, to_x, to_y, button, duration_ms)
}

#[cfg(target_os = "macos")]
fn input_hotkey(combo: &str) -> CallToolResult {
    crate::platform::macos::input_sim::hotkey(combo)
}

#[cfg(target_os = "macos")]
fn input_mouse_click(x: f64, y: f64, button: &str, clicks: u32) -> CallToolResult {
    crate::platform::macos::input_sim::mouse_click(x, y, button, clicks)
}

#[cfg(not(target_os = "macos"))]
fn input_scroll(_x: f64, _y: f64, _delta_y: i32, _delta_x: i32) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_drag(_from_x: f64, _from_y: f64, _to_x: f64, _to_y: f64, _button: &str, _duration_ms: u64) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_hotkey(_combo: &str) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_key(_key: &str, _modifiers: &[String]) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_type(_text: &str, _delay_ms: u64) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_mouse_move(_x: f64, _y: f64) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn input_mouse_click(_x: f64, _y: f64, _button: &str, _clicks: u32) -> CallToolResult {
    CallToolResult::error("Input simulation not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(InputSimProvider::new())
}
