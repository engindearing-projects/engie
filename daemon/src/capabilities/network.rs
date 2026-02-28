use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct NetworkProvider;

impl NetworkProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for NetworkProvider {
    fn id(&self) -> &str {
        "network"
    }

    fn name(&self) -> &str {
        "Network"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "network_info".into(),
                description: "Get network information: hostname, IP addresses, gateway, DNS servers.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "network_wifi".into(),
                description: "Get current WiFi connection details: SSID, signal strength, channel, security.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "network_ping".into(),
                description: "Ping a host to check connectivity.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "host": {
                            "type": "string",
                            "description": "Hostname or IP address to ping"
                        },
                        "count": {
                            "type": "number",
                            "description": "Number of ping packets to send (default 4)",
                            "minimum": 1,
                            "maximum": 100
                        }
                    },
                    "required": ["host"]
                }),
            },
            Tool {
                name: "network_interfaces".into(),
                description: "List all network interfaces with their addresses and status.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "network_info" => Some(network_info()),
            "network_wifi" => Some(network_wifi()),
            "network_ping" => {
                let host = arguments["host"].as_str().unwrap_or("");
                let count = arguments["count"].as_u64().unwrap_or(4) as u32;
                Some(network_ping(host, count))
            }
            "network_interfaces" => Some(network_interfaces()),
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn network_info() -> CallToolResult {
    crate::platform::macos::network::get_info()
}

#[cfg(target_os = "macos")]
fn network_wifi() -> CallToolResult {
    crate::platform::macos::network::get_wifi()
}

#[cfg(target_os = "macos")]
fn network_ping(host: &str, count: u32) -> CallToolResult {
    crate::platform::macos::network::ping(host, count)
}

#[cfg(target_os = "macos")]
fn network_interfaces() -> CallToolResult {
    crate::platform::macos::network::get_interfaces()
}

#[cfg(not(target_os = "macos"))]
fn network_info() -> CallToolResult {
    CallToolResult::error("Network not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn network_wifi() -> CallToolResult {
    CallToolResult::error("Network not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn network_ping(_host: &str, _count: u32) -> CallToolResult {
    CallToolResult::error("Network not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn network_interfaces() -> CallToolResult {
    CallToolResult::error("Network not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(NetworkProvider::new())
}
