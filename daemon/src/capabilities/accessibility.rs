use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct AccessibilityProvider;

impl AccessibilityProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for AccessibilityProvider {
    fn id(&self) -> &str {
        "accessibility"
    }

    fn name(&self) -> &str {
        "Accessibility"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "ax_read_tree".into(),
                description: "Read the UI element tree for an application. Returns roles, titles, values, positions, and sizes as nested JSON.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "depth": {
                            "type": "number",
                            "description": "Maximum depth to traverse (default: 3)"
                        }
                    },
                    "required": ["pid"]
                }),
            },
            Tool {
                name: "ax_focused_element".into(),
                description: "Get the currently focused UI element. Returns its role, title, value, position, and size.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "ax_click".into(),
                description: "Click a UI element by its role and optional title. Performs the AXPress action.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match (e.g. \"AXButton\", \"AXMenuItem\")"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        }
                    },
                    "required": ["pid", "role"]
                }),
            },
            Tool {
                name: "ax_set_value".into(),
                description: "Set the value of a UI element found by role and optional title.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match (e.g. \"AXTextField\", \"AXTextArea\")"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        },
                        "value": {
                            "type": "string",
                            "description": "Value to set on the element"
                        }
                    },
                    "required": ["pid", "role", "value"]
                }),
            },
            Tool {
                name: "ax_element_info".into(),
                description: "Get detailed attributes of a UI element found by role and optional title.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        }
                    },
                    "required": ["pid", "role"]
                }),
            },
            Tool {
                name: "ax_find_element".into(),
                description: "Search the accessibility tree by role, title, or value pattern. Returns all matching elements with their bounds. More flexible than ax_click — supports partial matching and returns multiple results.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match (e.g. \"AXButton\"). Optional if title_pattern is provided."
                        },
                        "title_pattern": {
                            "type": "string",
                            "description": "Substring to match in element title (case-insensitive)"
                        },
                        "value_pattern": {
                            "type": "string",
                            "description": "Substring to match in element value (case-insensitive)"
                        },
                        "max_results": {
                            "type": "number",
                            "description": "Maximum number of results to return (default: 10)"
                        },
                        "max_depth": {
                            "type": "number",
                            "description": "Maximum depth to search (default: 10)"
                        }
                    },
                    "required": ["pid"]
                }),
            },
            Tool {
                name: "ax_get_actions".into(),
                description: "List available actions on a UI element found by role and optional title. Returns action names like AXPress, AXIncrement, AXPick, etc.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        }
                    },
                    "required": ["pid", "role"]
                }),
            },
            Tool {
                name: "ax_perform_action".into(),
                description: "Execute a named action on a UI element. Use ax_get_actions to discover available actions first.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role to match"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        },
                        "action": {
                            "type": "string",
                            "description": "Action name to perform (e.g. \"AXPress\", \"AXIncrement\", \"AXShowMenu\")"
                        }
                    },
                    "required": ["pid", "role", "action"]
                }),
            },
            Tool {
                name: "ax_scroll".into(),
                description: "Scroll within a scroll area element found by role/title in an application.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pid": {
                            "type": "number",
                            "description": "Process ID of the target application"
                        },
                        "role": {
                            "type": "string",
                            "description": "AX role of the scroll area (default: \"AXScrollArea\")"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional title to match for disambiguation"
                        },
                        "direction": {
                            "type": "string",
                            "description": "Scroll direction: \"up\", \"down\", \"left\", \"right\""
                        },
                        "amount": {
                            "type": "number",
                            "description": "Number of scroll lines (default: 5)"
                        }
                    },
                    "required": ["pid", "direction"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "ax_read_tree" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let depth = arguments["depth"].as_u64().unwrap_or(3) as usize;
                Some(ax_read_tree(pid, depth))
            }
            "ax_focused_element" => Some(ax_focused_element()),
            "ax_click" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("");
                let title = arguments["title"].as_str();
                Some(ax_click(pid, role, title))
            }
            "ax_set_value" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("");
                let title = arguments["title"].as_str();
                let value = arguments["value"].as_str().unwrap_or("");
                Some(ax_set_value(pid, role, title, value))
            }
            "ax_element_info" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("");
                let title = arguments["title"].as_str();
                Some(ax_element_info(pid, role, title))
            }
            "ax_find_element" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str();
                let title_pattern = arguments["title_pattern"].as_str();
                let value_pattern = arguments["value_pattern"].as_str();
                let max_results = arguments["max_results"].as_u64().unwrap_or(10) as usize;
                let max_depth = arguments["max_depth"].as_u64().unwrap_or(10) as usize;
                Some(ax_find_element(pid, role, title_pattern, value_pattern, max_results, max_depth))
            }
            "ax_get_actions" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("");
                let title = arguments["title"].as_str();
                Some(ax_get_actions(pid, role, title))
            }
            "ax_perform_action" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("");
                let title = arguments["title"].as_str();
                let action = arguments["action"].as_str().unwrap_or("");
                Some(ax_perform_action(pid, role, title, action))
            }
            "ax_scroll" => {
                let pid = arguments["pid"].as_i64().unwrap_or(0) as i32;
                let role = arguments["role"].as_str().unwrap_or("AXScrollArea");
                let title = arguments["title"].as_str();
                let direction = arguments["direction"].as_str().unwrap_or("down");
                let amount = arguments["amount"].as_i64().unwrap_or(5) as i32;
                Some(ax_scroll(pid, role, title, direction, amount))
            }
            _ => None,
        }
    }
}

// ── Platform dispatch ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn ax_read_tree(pid: i32, depth: usize) -> CallToolResult {
    crate::platform::macos::accessibility::read_tree(pid, depth)
}

#[cfg(target_os = "macos")]
fn ax_focused_element() -> CallToolResult {
    crate::platform::macos::accessibility::focused_element()
}

#[cfg(target_os = "macos")]
fn ax_click(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    crate::platform::macos::accessibility::click_element(pid, role, title)
}

#[cfg(target_os = "macos")]
fn ax_set_value(pid: i32, role: &str, title: Option<&str>, value: &str) -> CallToolResult {
    crate::platform::macos::accessibility::set_value(pid, role, title, value)
}

#[cfg(target_os = "macos")]
fn ax_element_info(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    crate::platform::macos::accessibility::element_info(pid, role, title)
}

#[cfg(not(target_os = "macos"))]
fn ax_read_tree(_pid: i32, _depth: usize) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_focused_element() -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_click(_pid: i32, _role: &str, _title: Option<&str>) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_set_value(_pid: i32, _role: &str, _title: Option<&str>, _value: &str) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(target_os = "macos")]
fn ax_find_element(pid: i32, role: Option<&str>, title_pattern: Option<&str>, value_pattern: Option<&str>, max_results: usize, max_depth: usize) -> CallToolResult {
    crate::platform::macos::accessibility::find_elements(pid, role, title_pattern, value_pattern, max_results, max_depth)
}

#[cfg(target_os = "macos")]
fn ax_get_actions(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    crate::platform::macos::accessibility::get_actions(pid, role, title)
}

#[cfg(target_os = "macos")]
fn ax_perform_action(pid: i32, role: &str, title: Option<&str>, action: &str) -> CallToolResult {
    crate::platform::macos::accessibility::perform_action(pid, role, title, action)
}

#[cfg(target_os = "macos")]
fn ax_scroll(pid: i32, role: &str, title: Option<&str>, direction: &str, amount: i32) -> CallToolResult {
    crate::platform::macos::accessibility::scroll_element(pid, role, title, direction, amount)
}

#[cfg(not(target_os = "macos"))]
fn ax_element_info(_pid: i32, _role: &str, _title: Option<&str>) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_find_element(_pid: i32, _role: Option<&str>, _title_pattern: Option<&str>, _value_pattern: Option<&str>, _max_results: usize, _max_depth: usize) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_get_actions(_pid: i32, _role: &str, _title: Option<&str>) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_perform_action(_pid: i32, _role: &str, _title: Option<&str>, _action: &str) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ax_scroll(_pid: i32, _role: &str, _title: Option<&str>, _direction: &str, _amount: i32) -> CallToolResult {
    CallToolResult::error("Accessibility not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(AccessibilityProvider::new())
}
