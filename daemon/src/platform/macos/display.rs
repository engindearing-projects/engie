use std::process::Command;
use serde_json::{json, Value};

use crate::mcp::types::CallToolResult;

/// Get the current display brightness by parsing ioreg output.
pub fn get_brightness() -> CallToolResult {
    match Command::new("ioreg")
        .args(["-rc", "AppleBacklightDisplay"])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Look for "brightness" = { ... "value" = N ... } pattern
            // The ioreg output typically has: "brightness" = {"min"=0,"max"=1,"value"=0.5}
            // or a simpler flat integer form depending on macOS version.
            if let Some(brightness) = parse_brightness(&stdout) {
                CallToolResult::json(&json!({
                    "brightness": brightness,
                    "source": "ioreg"
                }))
            } else {
                // Fallback: check if there's no backlight display (e.g. external monitor)
                CallToolResult::error(
                    "Could not read brightness. This may be an external display \
                     without backlight control, or the ioreg format is unexpected."
                )
            }
        }
        Err(e) => CallToolResult::error(format!("Failed to run ioreg: {e}")),
    }
}

/// Parse brightness value from ioreg output.
/// Handles both `"brightness" = N` and `"brightness" = {"value" = N}` forms.
fn parse_brightness(output: &str) -> Option<f64> {
    for line in output.lines() {
        let trimmed = line.trim();

        // Match: "brightness" = 0.5  or  "brightness" = 1024
        if trimmed.contains("\"brightness\"") {
            // Try to extract value from dict form: "value" = N
            if let Some(val_pos) = trimmed.find("\"value\"") {
                let after = &trimmed[val_pos..];
                if let Some(eq_pos) = after.find('=') {
                    let num_str = after[eq_pos + 1..]
                        .trim()
                        .trim_end_matches(|c: char| c == '}' || c == ',' || c.is_whitespace());
                    if let Ok(v) = num_str.trim().parse::<f64>() {
                        return Some(v);
                    }
                }
            }

            // Try simple form: "brightness" = N
            if let Some(eq_pos) = trimmed.find('=') {
                let after = trimmed[eq_pos + 1..].trim();
                // Skip if it's a dict (starts with {)
                if !after.starts_with('{') {
                    if let Ok(v) = after.parse::<f64>() {
                        return Some(v);
                    }
                }
            }
        }
    }
    None
}

/// Get display information via system_profiler.
pub fn get_info() -> CallToolResult {
    match Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<Value>(&stdout) {
                Ok(parsed) => CallToolResult::json(&parsed),
                Err(_) => CallToolResult::text(stdout),
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("system_profiler failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run system_profiler: {e}")),
    }
}

/// Get the current dark mode setting.
pub fn get_dark_mode() -> CallToolResult {
    match Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let is_dark = stdout == "Dark";
            CallToolResult::json(&json!({
                "dark_mode": is_dark,
                "style": if is_dark { "dark" } else { "light" }
            }))
        }
        Ok(_) => {
            // Non-zero exit means the key doesn't exist = light mode
            CallToolResult::json(&json!({
                "dark_mode": false,
                "style": "light"
            }))
        }
        Err(e) => CallToolResult::error(format!("Failed to read dark mode setting: {e}")),
    }
}

/// Set the dark mode on or off via osascript.
pub fn set_dark_mode(enabled: bool) -> CallToolResult {
    let script = format!(
        "tell application \"System Events\" to tell appearance preferences to set dark mode to {}",
        if enabled { "true" } else { "false" }
    );

    match Command::new("osascript")
        .args(["-e", &script])
        .output()
    {
        Ok(output) if output.status.success() => {
            CallToolResult::text(format!(
                "Dark mode {}",
                if enabled { "enabled" } else { "disabled" }
            ))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("Failed to set dark mode: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}
