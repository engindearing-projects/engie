use std::process::Command;
use serde_json::{json, Value};

use crate::mcp::types::CallToolResult;

/// List running GUI applications using osascript.
pub fn list_apps() -> CallToolResult {
    let script = r#"
tell application "System Events"
    set appList to ""
    repeat with p in (every application process whose background only is false)
        set appName to name of p
        set appPid to (unix id of p as text)
        try
            set appBundle to (bundle identifier of p as text)
        on error
            set appBundle to "unknown"
        end try
        set isFront to (frontmost of p as text)
        set appList to appList & appName & "|||" & appPid & "|||" & appBundle & "|||" & isFront & linefeed
    end repeat
    return appList
end tell
"#;

    match Command::new("osascript").arg("-e").arg(script).output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let apps: Vec<Value> = stdout
                .lines()
                .filter(|line| !line.trim().is_empty())
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split("|||").collect();
                    if parts.len() >= 4 {
                        Some(json!({
                            "name": parts[0].trim(),
                            "pid": parts[1].trim().parse::<i64>().unwrap_or(0),
                            "bundle_id": parts[2].trim(),
                            "frontmost": parts[3].trim() == "true",
                        }))
                    } else {
                        None
                    }
                })
                .collect();

            CallToolResult::json(&json!(apps))
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}

/// Get info for a specific app by name.
pub fn app_info(name: &str) -> CallToolResult {
    let script = format!(
        r#"
tell application "System Events"
    try
        set p to (first application process whose name is "{name}")
        set appName to name of p
        set appPid to (unix id of p as text)
        try
            set appBundle to (bundle identifier of p as text)
        on error
            set appBundle to "unknown"
        end try
        set isFront to (frontmost of p as text)
        set isVisible to (visible of p as text)
        return appName & "|||" & appPid & "|||" & appBundle & "|||" & isFront & "|||" & isVisible
    on error errMsg
        return "ERROR:" & errMsg
    end try
end tell
"#
    );

    match Command::new("osascript").arg("-e").arg(&script).output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

            if stdout.starts_with("ERROR:") {
                return CallToolResult::error(format!(
                    "App '{}' not found: {}",
                    name,
                    &stdout[6..]
                ));
            }

            let parts: Vec<&str> = stdout.split("|||").collect();
            if parts.len() >= 5 {
                CallToolResult::json(&json!({
                    "name": parts[0].trim(),
                    "pid": parts[1].trim().parse::<i64>().unwrap_or(0),
                    "bundle_id": parts[2].trim(),
                    "frontmost": parts[3].trim() == "true",
                    "visible": parts[4].trim() == "true",
                }))
            } else {
                CallToolResult::error(format!("Unexpected output format: {stdout}"))
            }
        }
        Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
    }
}

/// Launch an application by name.
pub fn launch_app(name: &str) -> CallToolResult {
    match Command::new("open").args(["-a", name]).output() {
        Ok(output) => {
            if output.status.success() {
                CallToolResult::text(format!("Launched '{name}'"))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                CallToolResult::error(format!("Failed to launch '{name}': {stderr}"))
            }
        }
        Err(e) => CallToolResult::error(format!("Failed to run open: {e}")),
    }
}

/// Quit an application by name. If force is true, use killall instead of graceful quit.
pub fn quit_app(name: &str, force: bool) -> CallToolResult {
    if force {
        match Command::new("killall").arg(name).output() {
            Ok(output) => {
                if output.status.success() {
                    CallToolResult::text(format!("Force-killed '{name}'"))
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CallToolResult::error(format!("Failed to kill '{name}': {stderr}"))
                }
            }
            Err(e) => CallToolResult::error(format!("Failed to run killall: {e}")),
        }
    } else {
        let script = format!(r#"tell application "{name}" to quit"#);
        match Command::new("osascript").arg("-e").arg(&script).output() {
            Ok(output) => {
                if output.status.success() {
                    CallToolResult::text(format!("Quit '{name}'"))
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CallToolResult::error(format!("Failed to quit '{name}': {stderr}"))
                }
            }
            Err(e) => CallToolResult::error(format!("Failed to run osascript: {e}")),
        }
    }
}
