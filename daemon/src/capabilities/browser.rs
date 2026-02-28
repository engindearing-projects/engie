use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct BrowserProvider;

impl BrowserProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for BrowserProvider {
    fn id(&self) -> &str {
        "browser"
    }

    fn name(&self) -> &str {
        "Browser"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "browser_open".into(),
                description: "Open a URL in the default or specified browser.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The URL to open (must start with http://, https://, or file://)"
                        },
                        "browser": {
                            "type": "string",
                            "description": "Browser application name (e.g. \"Safari\", \"Google Chrome\", \"Firefox\"). Omit for system default."
                        }
                    },
                    "required": ["url"]
                }),
            },
            Tool {
                name: "browser_tabs".into(),
                description: "List all open browser tabs with titles and URLs.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "browser": {
                            "type": "string",
                            "description": "Browser to query (e.g. \"Safari\", \"Google Chrome\"). Omit to try Safari then Chrome."
                        }
                    },
                }),
            },
            Tool {
                name: "browser_active_tab".into(),
                description: "Get the title and URL of the active browser tab.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "browser": {
                            "type": "string",
                            "description": "Browser to query (e.g. \"Safari\", \"Google Chrome\"). Omit to try Safari then Chrome."
                        }
                    },
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "browser_open" => {
                let url = arguments["url"].as_str().unwrap_or("");
                let browser = arguments["browser"].as_str();
                Some(browser_open(url, browser))
            }
            "browser_tabs" => {
                let browser = arguments["browser"].as_str();
                Some(browser_tabs(browser))
            }
            "browser_active_tab" => {
                let browser = arguments["browser"].as_str();
                Some(browser_active_tab(browser))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn browser_open(url: &str, browser: Option<&str>) -> CallToolResult {
    crate::platform::macos::browser::open_url(url, browser)
}

#[cfg(target_os = "macos")]
fn browser_tabs(browser: Option<&str>) -> CallToolResult {
    crate::platform::macos::browser::get_tabs(browser)
}

#[cfg(target_os = "macos")]
fn browser_active_tab(browser: Option<&str>) -> CallToolResult {
    crate::platform::macos::browser::get_active_tab(browser)
}

#[cfg(not(target_os = "macos"))]
fn browser_open(_url: &str, _browser: Option<&str>) -> CallToolResult {
    CallToolResult::error("Browser not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn browser_tabs(_browser: Option<&str>) -> CallToolResult {
    CallToolResult::error("Browser not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn browser_active_tab(_browser: Option<&str>) -> CallToolResult {
    CallToolResult::error("Browser not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(BrowserProvider::new())
}
