use serde_json::Value;
use tracing::{debug, warn};

use crate::mcp::types::{CallToolResult, Tool};
use crate::permissions::PermissionsConfig;

#[cfg(feature = "system_info")]
pub mod system_info;
#[cfg(feature = "clipboard")]
pub mod clipboard;
#[cfg(feature = "notifications")]
pub mod notifications;
#[cfg(feature = "screenshots")]
pub mod screenshots;
#[cfg(feature = "window_mgmt")]
pub mod window_mgmt;
#[cfg(feature = "app_control")]
pub mod app_control;
#[cfg(feature = "input_sim")]
pub mod input_sim;
#[cfg(feature = "audio")]
pub mod audio;
#[cfg(feature = "display")]
pub mod display;
#[cfg(feature = "file_search")]
pub mod file_search;
#[cfg(feature = "accessibility")]
pub mod accessibility;
#[cfg(feature = "file_ops")]
pub mod file_ops;
#[cfg(feature = "network")]
pub mod network;
#[cfg(feature = "browser")]
pub mod browser;
#[cfg(feature = "defaults")]
pub mod defaults;
#[cfg(feature = "terminal")]
pub mod terminal;
#[cfg(feature = "ocr")]
pub mod ocr;

/// A capability that provides one or more MCP tools.
pub trait CapabilityProvider: Send + Sync {
    /// Unique identifier (e.g. "system_info", "clipboard").
    fn id(&self) -> &str;

    /// Human-readable name (e.g. "System Information").
    fn name(&self) -> &str;

    /// Return the MCP Tool definitions this capability provides.
    fn tools(&self) -> Vec<Tool>;

    /// Execute a tool call. Returns None if this provider doesn't handle the tool.
    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult>;
}

/// Registry of all enabled capability providers, gated by permissions.
pub struct CapabilityRegistry {
    providers: Vec<Box<dyn CapabilityProvider>>,
    permissions: PermissionsConfig,
}

impl CapabilityRegistry {
    pub fn new(permissions: PermissionsConfig) -> Self {
        Self {
            providers: Vec::new(),
            permissions,
        }
    }

    /// Register a capability provider (only if its capability is allowed).
    pub fn register(&mut self, provider: Box<dyn CapabilityProvider>) {
        let id = provider.id().to_string();
        if self.permissions.is_capability_allowed(&id) {
            debug!(capability = %id, "registered");
            self.providers.push(provider);
        } else {
            debug!(capability = %id, "skipped (not allowed)");
        }
    }

    /// List all tools from all registered (and permitted) providers.
    pub fn list_tools(&self) -> Vec<Tool> {
        self.providers
            .iter()
            .flat_map(|p| {
                p.tools()
                    .into_iter()
                    .filter(|t| self.permissions.is_tool_allowed(p.id(), &t.name))
            })
            .collect()
    }

    /// Call a tool by name, checking permissions.
    pub fn call_tool(&self, tool_name: &str, arguments: &Value) -> CallToolResult {
        for provider in &self.providers {
            if !self.permissions.is_tool_allowed(provider.id(), tool_name) {
                continue;
            }
            if let Some(result) = provider.call(tool_name, arguments) {
                return result;
            }
        }

        warn!(tool = %tool_name, "tool not found or not permitted");
        CallToolResult::error(format!("Tool '{tool_name}' not found or not permitted"))
    }

    pub fn tool_count(&self) -> usize {
        self.list_tools().len()
    }

    pub fn capability_count(&self) -> usize {
        self.providers.len()
    }
}
