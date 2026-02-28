use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Get current volume settings via `osascript`.
pub fn get_volume() -> CallToolResult {
    match Command::new("osascript")
        .args(["-e", "get volume settings"])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            // Output format: "output volume:50, input volume:75, alert volume:100, output muted:false"
            let mut result = json!({});
            for part in raw.trim().split(", ") {
                if let Some((key, value)) = part.split_once(':') {
                    let key = key.trim().replace(' ', "_");
                    let value = value.trim();
                    if let Ok(n) = value.parse::<i64>() {
                        result[&key] = json!(n);
                    } else if value == "true" {
                        result[&key] = json!(true);
                    } else if value == "false" {
                        result[&key] = json!(false);
                    } else if value == "missing value" {
                        result[&key] = json!(null);
                    } else {
                        result[&key] = json!(value);
                    }
                }
            }
            CallToolResult::json(&result)
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}

/// Set the output volume level (0-100) via `osascript`.
pub fn set_volume(level: u8) -> CallToolResult {
    let level = level.min(100);
    let script = format!("set volume output volume {level}");
    match Command::new("osascript")
        .args(["-e", &script])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            CallToolResult::text(format!("Volume set to {level}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}

/// Mute or unmute the output audio via `osascript`.
pub fn mute(muted: bool) -> CallToolResult {
    let script = if muted {
        "set volume with output muted"
    } else {
        "set volume without output muted"
    };
    match Command::new("osascript")
        .args(["-e", script])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            let state = if muted { "muted" } else { "unmuted" };
            CallToolResult::text(format!("Audio {state}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}

/// List audio devices via `system_profiler SPAudioDataType -json`.
pub fn devices() -> CallToolResult {
    match Command::new("system_profiler")
        .args(["SPAudioDataType", "-json"])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("system_profiler failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(parsed) => CallToolResult::json(&parsed),
                Err(_) => CallToolResult::text(raw),
            }
        }
        Err(e) => CallToolResult::error(format!("Failed to run system_profiler: {e}")),
    }
}
