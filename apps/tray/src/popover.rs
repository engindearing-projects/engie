//! Phase 2: Rich popover panel
//!
//! Activated by left-clicking the tray icon (handled in main.rs).
//! Gated behind the "popover" feature flag.
//!
//! Integration in main.rs event loop:
//! ```rust,ignore
//!   Event::UserEvent(UserEvent::TrayIconEvent(TrayIconEvent::Click { .. })) => {
//!       popover.toggle();
//!   }
//! ```
//!
//! Usage:
//! ```rust,ignore
//!   let mut popover = PopoverWindow::new(&event_loop, &initial_state)?;
//!
//!   // In the event loop, on tray click:
//!   popover.toggle();
//!
//!   // When state changes:
//!   popover.update_state(&new_state);
//!
//!   // To add a single tool call without full refresh:
//!   popover.add_tool_call("read", "just now");
//! ```

use crate::popover_ui::POPOVER_HTML;
use serde::Serialize;
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event_loop::EventLoopWindowTarget,
    monitor::MonitorHandle,
    window::{Window, WindowBuilder},
};
use wry::{http::Request, WebView, WebViewBuilder};

/// Represents a single tool call for the activity feed.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub name: String,
    pub time: String,
}

/// Full state payload sent to the popover UI via `updateState()`.
///
/// This is a richer superset of `crate::state::TrayState` — during integration,
/// build a `PopoverState` from the shared `TrayState` plus gateway metrics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopoverState {
    pub name: String,
    pub connected: bool,
    pub last_tools: Vec<ToolCall>,
    pub tool_count: u64,
    pub uptime: String,
    pub total_calls: u64,
}

impl Default for PopoverState {
    fn default() -> Self {
        Self {
            name: "Familiar".to_string(),
            connected: false,
            last_tools: Vec::new(),
            tool_count: 0,
            uptime: "\u{2014}".to_string(), // em-dash
            total_calls: 0,
        }
    }
}

/// IPC action sent from the popover's quick-action buttons.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PopoverAction {
    Restart,
    OpenLogs,
    Settings,
    Unknown(String),
}

impl From<&str> for PopoverAction {
    fn from(s: &str) -> Self {
        match s {
            "restart" => PopoverAction::Restart,
            "open_logs" => PopoverAction::OpenLogs,
            "settings" => PopoverAction::Settings,
            other => PopoverAction::Unknown(other.to_string()),
        }
    }
}

/// Callback type for IPC actions from the popover UI.
pub type ActionCallback = Box<dyn Fn(PopoverAction) + Send + 'static>;

/// The popover panel window — a small borderless webview anchored near the tray icon.
pub struct PopoverWindow {
    window: Window,
    webview: WebView,
    visible: bool,
}

/// Width of the popover panel in logical pixels.
const PANEL_WIDTH: f64 = 320.0;
/// Height of the popover panel in logical pixels.
const PANEL_HEIGHT: f64 = 400.0;
/// Margin from screen edges in logical pixels.
const EDGE_MARGIN: f64 = 8.0;

impl PopoverWindow {
    /// Creates a new popover window (starts hidden).
    ///
    /// `event_loop` — the tao event loop target (from the main event loop).
    /// `state` — initial state to render.
    /// `on_action` — optional callback invoked when the user clicks a quick-action button.
    pub fn new<T>(
        event_loop: &EventLoopWindowTarget<T>,
        state: &PopoverState,
        on_action: Option<ActionCallback>,
    ) -> Result<Self, Box<dyn std::error::Error>>
    where
        T: 'static,
    {
        let position = Self::compute_position(event_loop.primary_monitor());

        let window = WindowBuilder::new()
            .with_title("Familiar")
            .with_decorations(false)
            .with_transparent(true)
            .with_always_on_top(true)
            .with_resizable(false)
            .with_inner_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT))
            .with_position(position)
            .with_visible(false)
            // Skip showing in taskbar / dock
            .with_visible_on_all_workspaces(true)
            .build(event_loop)?;

        let action_handler = on_action;

        let webview = WebViewBuilder::new()
            .with_transparent(true)
            .with_html(POPOVER_HTML)
            .with_ipc_handler(move |req: Request<String>| {
                Self::handle_ipc(req.body(), &action_handler);
            })
            .build(&window)?;

        let mut popover = Self {
            window,
            webview,
            visible: false,
        };

        // Push initial state into the webview.
        popover.update_state(state);

        Ok(popover)
    }

    /// Show the popover panel with entrance animation.
    pub fn show(&mut self) {
        if !self.visible {
            self.visible = true;
            self.window.set_visible(true);
            self.window.set_focus();
            let _ = self.webview.evaluate_script("showPanel()");
        }
    }

    /// Hide the popover panel with exit animation.
    pub fn hide(&mut self) {
        if self.visible {
            self.visible = false;
            let _ = self.webview.evaluate_script("hidePanel()");
            // Ideally we'd delay hiding the window to let the animation play,
            // but for now just hide immediately.
            self.window.set_visible(false);
        }
    }

    /// Toggle visibility.
    pub fn toggle(&mut self) {
        if self.visible {
            self.hide();
        } else {
            self.show();
        }
    }

    /// Returns whether the panel is currently visible.
    pub fn is_visible(&self) -> bool {
        self.visible
    }

    /// Push a full state update into the webview.
    pub fn update_state(&mut self, state: &PopoverState) {
        match serde_json::to_string(state) {
            Ok(json) => {
                let script = format!("updateState({})", json);
                let _ = self.webview.evaluate_script(&script);
            }
            Err(e) => {
                eprintln!("[popover] Failed to serialize state: {}", e);
            }
        }
    }

    /// Push a single tool call to the activity feed without a full refresh.
    pub fn add_tool_call(&self, name: &str, time: &str) {
        let name_escaped = Self::escape_js_string(name);
        let time_escaped = Self::escape_js_string(time);
        let script = format!("addToolCall(\"{}\", \"{}\")", name_escaped, time_escaped);
        let _ = self.webview.evaluate_script(&script);
    }

    /// Reposition the popover (e.g., if the monitor layout changes).
    pub fn reposition(&self, monitor: Option<MonitorHandle>) {
        let pos = Self::compute_position(monitor);
        self.window.set_outer_position(pos);
    }

    /// Returns a reference to the underlying tao window.
    pub fn window(&self) -> &Window {
        &self.window
    }

    // ------- Private helpers -------

    /// Compute the screen position for the popover panel.
    ///
    /// - macOS: horizontally centered under the approximate tray icon position
    ///   (~100px from the right screen edge), with a 4px gap below the menu bar (y = 28).
    /// - Windows: bottom-right, above the taskbar (y = screen_height - panel_height - 52).
    /// - Fallback: sensible defaults.
    fn compute_position(monitor: Option<MonitorHandle>) -> LogicalPosition<f64> {
        let is_windows = cfg!(target_os = "windows");

        match monitor {
            Some(mon) => {
                let size = mon.size();
                let scale = mon.scale_factor();
                let screen_w = size.width as f64 / scale;
                let screen_h = size.height as f64 / scale;

                // Approximate tray icon center: ~100px from the right edge of the screen
                let tray_center_x = screen_w - 100.0;
                // Center the panel horizontally under the tray icon, but clamp to screen
                let x = (tray_center_x - PANEL_WIDTH / 2.0)
                    .max(EDGE_MARGIN)
                    .min(screen_w - PANEL_WIDTH - EDGE_MARGIN);

                let y = if is_windows {
                    // Windows: above the taskbar (roughly 52px from bottom).
                    screen_h - PANEL_HEIGHT - 52.0
                } else {
                    // macOS: menu bar is ~24px, add 4px gap below it.
                    28.0
                };

                LogicalPosition::new(x, y)
            }
            None => {
                // No monitor info — sensible default.
                if is_windows {
                    LogicalPosition::new(1200.0, 400.0)
                } else {
                    LogicalPosition::new(1200.0, 28.0)
                }
            }
        }
    }

    /// Handle an IPC message from the webview JavaScript.
    fn handle_ipc(msg: &str, callback: &Option<ActionCallback>) {
        // Parse the JSON { "action": "..." }
        let action_str = match serde_json::from_str::<serde_json::Value>(msg) {
            Ok(val) => val
                .get("action")
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .to_string(),
            Err(e) => {
                eprintln!("[popover] Bad IPC message: {} — {:?}", msg, e);
                return;
            }
        };

        if action_str.is_empty() {
            return;
        }

        let action = PopoverAction::from(action_str.as_str());

        if let Some(cb) = callback {
            cb(action);
        } else {
            // Default behavior: log the action.
            eprintln!("[popover] Action received (no handler): {:?}", action);
        }
    }

    /// Escape a string for safe embedding inside a JS double-quoted string literal.
    fn escape_js_string(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for c in s.chars() {
            match c {
                '\\' => out.push_str("\\\\"),
                '"' => out.push_str("\\\""),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                '\0' => out.push_str("\\0"),
                _ => out.push(c),
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_tray_state() {
        let state = PopoverState::default();
        assert_eq!(state.name, "Familiar");
        assert!(!state.connected);
        assert!(state.last_tools.is_empty());
        assert_eq!(state.tool_count, 0);
        assert_eq!(state.total_calls, 0);
    }

    #[test]
    fn test_popover_action_from_str() {
        assert_eq!(PopoverAction::from("restart"), PopoverAction::Restart);
        assert_eq!(PopoverAction::from("open_logs"), PopoverAction::OpenLogs);
        assert_eq!(PopoverAction::from("settings"), PopoverAction::Settings);
        assert_eq!(
            PopoverAction::from("unknown_thing"),
            PopoverAction::Unknown("unknown_thing".to_string())
        );
    }

    #[test]
    fn test_escape_js_string() {
        assert_eq!(
            PopoverWindow::escape_js_string(r#"hello "world""#),
            r#"hello \"world\""#
        );
        assert_eq!(
            PopoverWindow::escape_js_string("line1\nline2"),
            "line1\\nline2"
        );
        assert_eq!(
            PopoverWindow::escape_js_string("back\\slash"),
            "back\\\\slash"
        );
        assert_eq!(PopoverWindow::escape_js_string("clean"), "clean");
    }

    #[test]
    fn test_tray_state_serializes() {
        let state = PopoverState {
            name: "Familiar".to_string(),
            connected: true,
            last_tools: vec![ToolCall {
                name: "read".to_string(),
                time: "2s ago".to_string(),
            }],
            tool_count: 10,
            uptime: "1h 30m".to_string(),
            total_calls: 42,
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"connected\":true"));
        assert!(json.contains("\"toolCount\":10"));
        assert!(json.contains("\"totalCalls\":42"));
        assert!(json.contains("\"lastTools\""));
    }

    #[test]
    fn test_compute_position_no_monitor() {
        // Without a monitor, should return fallback positions.
        let pos = PopoverWindow::compute_position(None);
        if cfg!(target_os = "windows") {
            assert_eq!(pos, LogicalPosition::new(1200.0, 400.0));
        } else {
            assert_eq!(pos, LogicalPosition::new(1200.0, 28.0));
        }
    }
}
