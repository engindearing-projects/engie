use std::process::Command;
use crate::mcp::types::CallToolResult;

/// Send a native macOS notification via osascript.
/// This avoids needing UNUserNotificationCenter entitlements.
pub fn send(title: &str, body: &str, subtitle: Option<&str>) -> CallToolResult {
    // Sanitize inputs — strip quotes to avoid breaking the AppleScript string literals
    let clean = |s: &str| s.replace('"', "'").replace('\\', "");

    let subtitle_part = subtitle
        .map(|s| format!(" subtitle \"{}\"", clean(s)))
        .unwrap_or_default();

    let script = format!(
        "display notification \"{}\" with title \"{}\"{subtitle_part}",
        clean(body),
        clean(title),
    );

    match Command::new("osascript")
        .args(["-e", &script])
        .output()
    {
        Ok(output) if output.status.success() => {
            CallToolResult::text("Notification sent")
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("osascript failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to send notification: {e}")),
    }
}
