use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Check if tmux is available and running.
fn has_tmux() -> bool {
    Command::new("tmux")
        .args(["list-sessions"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── List Sessions ───────────────────────────────────────────────────────────

pub fn list_sessions() -> CallToolResult {
    if has_tmux() {
        list_tmux_sessions()
    } else {
        list_terminal_app_windows()
    }
}

fn list_tmux_sessions() -> CallToolResult {
    let output = match Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}:#{session_windows}:#{session_attached}"])
        .output()
    {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run tmux: {e}")),
    };

    if !output.status.success() {
        return CallToolResult::error("No tmux sessions found");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sessions = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, ':').collect();
        if parts.len() >= 3 {
            sessions.push(json!({
                "type": "tmux",
                "name": parts[0],
                "windows": parts[1],
                "attached": parts[2] == "1",
            }));
        }
    }

    // Also list panes
    let pane_output = Command::new("tmux")
        .args(["list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command} #{pane_width}x#{pane_height}"])
        .output();

    let mut panes = Vec::new();
    if let Ok(o) = pane_output {
        if o.status.success() {
            let stdout = String::from_utf8_lossy(&o.stdout);
            for line in stdout.lines() {
                let mut parts = line.splitn(3, ' ');
                if let (Some(target), Some(cmd), Some(size)) = (parts.next(), parts.next(), parts.next()) {
                    panes.push(json!({
                        "target": target,
                        "command": cmd,
                        "size": size,
                    }));
                }
            }
        }
    }

    CallToolResult::json(&json!({
        "backend": "tmux",
        "sessions": sessions,
        "panes": panes,
    }))
}

fn list_terminal_app_windows() -> CallToolResult {
    let script = r#"
        tell application "Terminal"
            set windowList to {}
            repeat with w in windows
                set end of windowList to {|index|:index of w, |name|:name of w, |visible|:visible of w}
            end repeat
            return windowList
        end tell
    "#;

    let output = match Command::new("osascript").args(["-e", script]).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
    };

    if !output.status.success() {
        return CallToolResult::text("No Terminal.app windows found. Use terminal_create to open one.");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    CallToolResult::json(&json!({
        "backend": "Terminal.app",
        "raw": stdout.trim(),
    }))
}

// ── Send Keys ───────────────────────────────────────────────────────────────

pub fn send_keys(target: &str, keys: &str, literal: bool) -> CallToolResult {
    if has_tmux() && (target.contains(':') || target.contains('.')) {
        send_tmux_keys(target, keys, literal)
    } else {
        send_terminal_app_keys(target, keys)
    }
}

fn send_tmux_keys(target: &str, keys: &str, literal: bool) -> CallToolResult {
    let mut args = vec!["send-keys", "-t", target];
    if literal {
        args.push("-l");
    }
    args.push(keys);

    let output = match Command::new("tmux").args(&args).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run tmux: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("tmux send-keys failed: {stderr}"));
    }

    CallToolResult::text(format!("Sent keys to tmux pane {target}"))
}

fn send_terminal_app_keys(target: &str, keys: &str) -> CallToolResult {
    let window_idx = target.parse::<i32>().unwrap_or(1);
    let escaped = keys.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "Terminal"
            do script "{escaped}" in window {window_idx}
        end tell"#
    );

    let output = match Command::new("osascript").args(["-e", &script]).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("Terminal.app send failed: {stderr}"));
    }

    CallToolResult::text(format!("Sent keys to Terminal.app window {window_idx}"))
}

// ── Capture ─────────────────────────────────────────────────────────────────

pub fn capture(target: &str, lines: usize) -> CallToolResult {
    if has_tmux() && (target.contains(':') || target.contains('.')) {
        capture_tmux(target, lines)
    } else {
        capture_terminal_app(target)
    }
}

fn capture_tmux(target: &str, lines: usize) -> CallToolResult {
    let start_line = format!("-{}", lines);
    let output = match Command::new("tmux")
        .args(["capture-pane", "-t", target, "-p", "-S", &start_line])
        .output()
    {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run tmux: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("tmux capture-pane failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    CallToolResult::text(stdout.to_string())
}

fn capture_terminal_app(target: &str) -> CallToolResult {
    let window_idx = target.parse::<i32>().unwrap_or(1);
    let script = format!(
        r#"tell application "Terminal"
            set termContent to contents of tab 1 of window {window_idx}
            return termContent
        end tell"#
    );

    let output = match Command::new("osascript").args(["-e", &script]).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("Terminal.app capture failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    CallToolResult::text(stdout.to_string())
}

// ── Create Session ──────────────────────────────────────────────────────────

pub fn create_session(name: Option<&str>, command: Option<&str>, directory: Option<&str>) -> CallToolResult {
    if has_tmux() || name.is_some() {
        create_tmux_session(name, command, directory)
    } else {
        create_terminal_app_window(command, directory)
    }
}

fn create_tmux_session(name: Option<&str>, command: Option<&str>, directory: Option<&str>) -> CallToolResult {
    let session_name = name.unwrap_or("familiar");

    // Check if tmux server is running; if not, this will start it
    let mut args = vec!["new-session", "-d", "-s", session_name];

    if let Some(dir) = directory {
        args.push("-c");
        args.push(dir);
    }

    if let Some(cmd) = command {
        args.push(cmd);
    }

    let output = match Command::new("tmux").args(&args).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run tmux: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If session already exists, that's OK
        if stderr.contains("duplicate session") {
            return CallToolResult::text(format!("tmux session '{session_name}' already exists"));
        }
        return CallToolResult::error(format!("tmux new-session failed: {stderr}"));
    }

    CallToolResult::json(&json!({
        "backend": "tmux",
        "session": session_name,
        "target": format!("{session_name}:0.0"),
    }))
}

fn create_terminal_app_window(command: Option<&str>, directory: Option<&str>) -> CallToolResult {
    let mut script_parts = Vec::new();

    script_parts.push("tell application \"Terminal\"".to_string());
    script_parts.push("  activate".to_string());

    if let Some(dir) = directory {
        let escaped_dir = dir.replace('\\', "\\\\").replace('"', "\\\"");
        if let Some(cmd) = command {
            let escaped_cmd = cmd.replace('\\', "\\\\").replace('"', "\\\"");
            script_parts.push(format!("  do script \"cd '{escaped_dir}' && {escaped_cmd}\""));
        } else {
            script_parts.push(format!("  do script \"cd '{escaped_dir}'\""));
        }
    } else if let Some(cmd) = command {
        let escaped_cmd = cmd.replace('\\', "\\\\").replace('"', "\\\"");
        script_parts.push(format!("  do script \"{escaped_cmd}\""));
    } else {
        script_parts.push("  do script \"\"".to_string());
    }

    script_parts.push("end tell".to_string());

    let script = script_parts.join("\n");
    let output = match Command::new("osascript").args(["-e", &script]).output() {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("Terminal.app create failed: {stderr}"));
    }

    CallToolResult::json(&json!({
        "backend": "Terminal.app",
        "created": true,
    }))
}
