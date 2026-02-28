use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct DefaultsProvider;

impl DefaultsProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for DefaultsProvider {
    fn id(&self) -> &str {
        "defaults"
    }

    fn name(&self) -> &str {
        "Defaults"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "defaults_read".into(),
                description: "Read a macOS defaults value for a domain and optional key.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "domain": {
                            "type": "string",
                            "description": "The defaults domain (e.g. \"com.apple.dock\", \"NSGlobalDomain\", \"-globalDomain\")"
                        },
                        "key": {
                            "type": "string",
                            "description": "Optional key within the domain. If omitted, reads the entire domain."
                        }
                    },
                    "required": ["domain"]
                }),
            },
            Tool {
                name: "defaults_write".into(),
                description: "Write a macOS defaults value.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "domain": {
                            "type": "string",
                            "description": "The defaults domain (e.g. \"com.apple.dock\")"
                        },
                        "key": {
                            "type": "string",
                            "description": "The key to write"
                        },
                        "value_type": {
                            "type": "string",
                            "description": "The type of the value",
                            "enum": ["string", "int", "float", "bool"]
                        },
                        "value": {
                            "type": "string",
                            "description": "The value to write (for bool: true/false/yes/no/1/0)"
                        }
                    },
                    "required": ["domain", "key", "value_type", "value"]
                }),
            },
            Tool {
                name: "defaults_delete".into(),
                description: "Delete a macOS defaults key.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "domain": {
                            "type": "string",
                            "description": "The defaults domain"
                        },
                        "key": {
                            "type": "string",
                            "description": "The key to delete"
                        }
                    },
                    "required": ["domain", "key"]
                }),
            },
            Tool {
                name: "defaults_domains".into(),
                description: "List all macOS defaults domains.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "defaults_find".into(),
                description: "Search all macOS defaults for a keyword.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "keyword": {
                            "type": "string",
                            "description": "The keyword to search for across all defaults domains"
                        }
                    },
                    "required": ["keyword"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "defaults_read" => {
                let domain = arguments["domain"].as_str().unwrap_or("");
                let key = arguments["key"].as_str();
                Some(defaults_read(domain, key))
            }
            "defaults_write" => {
                let domain = arguments["domain"].as_str().unwrap_or("");
                let key = arguments["key"].as_str().unwrap_or("");
                let value_type = arguments["value_type"].as_str().unwrap_or("");
                let value = arguments["value"].as_str().unwrap_or("");
                Some(defaults_write(domain, key, value_type, value))
            }
            "defaults_delete" => {
                let domain = arguments["domain"].as_str().unwrap_or("");
                let key = arguments["key"].as_str().unwrap_or("");
                Some(defaults_delete(domain, key))
            }
            "defaults_domains" => Some(defaults_domains()),
            "defaults_find" => {
                let keyword = arguments["keyword"].as_str().unwrap_or("");
                Some(defaults_find(keyword))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn defaults_read(domain: &str, key: Option<&str>) -> CallToolResult {
    crate::platform::macos::defaults::read_default(domain, key)
}

#[cfg(target_os = "macos")]
fn defaults_write(domain: &str, key: &str, value_type: &str, value: &str) -> CallToolResult {
    crate::platform::macos::defaults::write_default(domain, key, value_type, value)
}

#[cfg(target_os = "macos")]
fn defaults_delete(domain: &str, key: &str) -> CallToolResult {
    crate::platform::macos::defaults::delete_default(domain, key)
}

#[cfg(target_os = "macos")]
fn defaults_domains() -> CallToolResult {
    crate::platform::macos::defaults::list_domains()
}

#[cfg(target_os = "macos")]
fn defaults_find(keyword: &str) -> CallToolResult {
    crate::platform::macos::defaults::find_default(keyword)
}

#[cfg(not(target_os = "macos"))]
fn defaults_read(_domain: &str, _key: Option<&str>) -> CallToolResult {
    CallToolResult::error("Defaults not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn defaults_write(_domain: &str, _key: &str, _value_type: &str, _value: &str) -> CallToolResult {
    CallToolResult::error("Defaults not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn defaults_delete(_domain: &str, _key: &str) -> CallToolResult {
    CallToolResult::error("Defaults not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn defaults_domains() -> CallToolResult {
    CallToolResult::error("Defaults not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn defaults_find(_keyword: &str) -> CallToolResult {
    CallToolResult::error("Defaults not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(DefaultsProvider::new())
}
