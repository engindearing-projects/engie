use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use crate::mcp::types::CallToolResult;

/// Generate a unique temp file path for a screenshot.
fn temp_path() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("/tmp/familiar-screenshot-{ts}.png")
}

/// Read a screenshot file, base64-encode it, delete the temp file, and return an image result.
fn read_and_cleanup(path: &str) -> CallToolResult {
    match fs::read(path) {
        Ok(bytes) => {
            let _ = fs::remove_file(path);
            let b64 = STANDARD.encode(&bytes);
            CallToolResult::image(b64, "image/png")
        }
        Err(e) => {
            let _ = fs::remove_file(path);
            CallToolResult::error(format!("Failed to read screenshot file: {e}"))
        }
    }
}

/// Capture the full screen (or a specific display).
pub fn capture_screen(display_id: Option<u32>) -> CallToolResult {
    let path = temp_path();
    let mut cmd = Command::new("screencapture");
    cmd.args(["-x", "-t", "png"]);

    if let Some(id) = display_id {
        cmd.args(["-D", &id.to_string()]);
    }

    cmd.arg(&path);

    match cmd.output() {
        Ok(output) if output.status.success() => read_and_cleanup(&path),
        Ok(output) => {
            let _ = fs::remove_file(&path);
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("screencapture failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run screencapture: {e}")),
    }
}

/// Capture a specific window by its window ID.
pub fn capture_window(window_id: u32) -> CallToolResult {
    let path = temp_path();

    match Command::new("screencapture")
        .args(["-x", "-t", "png", "-l", &window_id.to_string(), &path])
        .output()
    {
        Ok(output) if output.status.success() => read_and_cleanup(&path),
        Ok(output) => {
            let _ = fs::remove_file(&path);
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("screencapture failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run screencapture: {e}")),
    }
}

/// Capture a rectangular region of the screen.
pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> CallToolResult {
    let path = temp_path();
    let region = format!("{x},{y},{width},{height}");

    match Command::new("screencapture")
        .args(["-x", "-t", "png", "-R", &region, &path])
        .output()
    {
        Ok(output) if output.status.success() => read_and_cleanup(&path),
        Ok(output) => {
            let _ = fs::remove_file(&path);
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("screencapture failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run screencapture: {e}")),
    }
}
