use std::collections::HashSet;

/// A single recorded tool call with its timestamp.
pub struct ToolCallRecord {
    pub name: String,
    pub timestamp: std::time::Instant,
}

/// Shared application state for the tray icon.
pub struct TrayState {
    pub name: String,
    pub connected: bool,
    pub last_tool: Option<String>,
    pub last_tools: Vec<ToolCallRecord>,
    /// Unique tool names seen this session.
    pub unique_tools: HashSet<String>,
    /// Last status text from the gateway.
    pub gateway_status: Option<String>,
}

impl TrayState {
    pub fn new(name: String) -> Self {
        Self {
            name,
            connected: false,
            last_tool: None,
            last_tools: Vec::new(),
            unique_tools: HashSet::new(),
            gateway_status: None,
        }
    }

    pub fn status_text(&self) -> String {
        let status = if self.connected {
            "connected"
        } else {
            "disconnected"
        };
        format!("{} \u{2014} {}", self.name, status)
    }

    pub fn last_tool_text(&self) -> String {
        match &self.last_tool {
            Some(name) => format!("Last: {}", name),
            None => "Last: (none)".into(),
        }
    }

    /// Push a tool call to the front of the history, keeping at most 5 entries.
    pub fn add_tool_call(&mut self, name: String) {
        self.last_tool = Some(name.clone());
        self.unique_tools.insert(name.clone());
        self.last_tools.insert(
            0,
            ToolCallRecord {
                name,
                timestamp: std::time::Instant::now(),
            },
        );
        self.last_tools.truncate(5);
    }
}

/// Format an `Instant` as a human-readable relative time string.
pub fn format_relative(instant: std::time::Instant) -> String {
    let secs = instant.elapsed().as_secs();
    if secs < 5 {
        return "just now".into();
    }
    if secs < 60 {
        return format!("{}s ago", secs);
    }
    if secs < 3600 {
        return format!("{}m ago", secs / 60);
    }
    format!("{}h ago", secs / 3600)
}
