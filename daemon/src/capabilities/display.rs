use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct DisplayProvider;

impl DisplayProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for DisplayProvider {
    fn id(&self) -> &str {
        "display"
    }

    fn name(&self) -> &str {
        "Display"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "display_brightness".into(),
                description: "Get the current display brightness level. Returns the brightness value from ioreg. Note: setting brightness is not supported without third-party tools.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "level": {
                            "type": "number",
                            "description": "Brightness level to set (0.0 to 1.0). Currently not supported — providing this will return an error explaining the limitation."
                        }
                    },
                }),
            },
            Tool {
                name: "display_info".into(),
                description: "Get detailed display hardware information including resolution, GPU, and connected displays via system_profiler.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "display_dark_mode".into(),
                description: "Get or set macOS dark mode. If 'enabled' param is provided, sets dark mode on/off. Otherwise returns the current dark mode state.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "enabled": {
                            "type": "boolean",
                            "description": "Set dark mode on (true) or off (false). Omit to just read current state."
                        }
                    },
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "display_brightness" => {
                if arguments.get("level").is_some() && !arguments["level"].is_null() {
                    Some(CallToolResult::error(
                        "Setting brightness is not supported without third-party tools. \
                         Install the `brightness` CLI (`brew install brightness`) and use \
                         it directly from the shell to adjust brightness."
                    ))
                } else {
                    Some(display_get_brightness())
                }
            }
            "display_info" => Some(display_info()),
            "display_dark_mode" => {
                match arguments.get("enabled") {
                    Some(v) if !v.is_null() => {
                        let enabled = v.as_bool().unwrap_or(false);
                        Some(display_set_dark_mode(enabled))
                    }
                    _ => Some(display_get_dark_mode()),
                }
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn display_get_brightness() -> CallToolResult {
    crate::platform::macos::display::get_brightness()
}

#[cfg(target_os = "macos")]
fn display_info() -> CallToolResult {
    crate::platform::macos::display::get_info()
}

#[cfg(target_os = "macos")]
fn display_get_dark_mode() -> CallToolResult {
    crate::platform::macos::display::get_dark_mode()
}

#[cfg(target_os = "macos")]
fn display_set_dark_mode(enabled: bool) -> CallToolResult {
    crate::platform::macos::display::set_dark_mode(enabled)
}

#[cfg(not(target_os = "macos"))]
fn display_get_brightness() -> CallToolResult {
    CallToolResult::error("Display brightness not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn display_info() -> CallToolResult {
    CallToolResult::error("Display info not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn display_get_dark_mode() -> CallToolResult {
    CallToolResult::error("Dark mode not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn display_set_dark_mode(_enabled: bool) -> CallToolResult {
    CallToolResult::error("Dark mode not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(DisplayProvider::new())
}
