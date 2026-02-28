use std::process::Command;
use crate::mcp::types::CallToolResult;

/// Read clipboard text via `pbpaste`.
pub fn read() -> CallToolResult {
    match Command::new("pbpaste").output() {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout);
            CallToolResult::text(text)
        }
        Err(e) => CallToolResult::error(format!("Failed to read clipboard: {e}")),
    }
}

/// Write text to clipboard via `pbcopy`.
pub fn write(text: &str) -> CallToolResult {
    use std::io::Write;
    use std::process::Stdio;

    match Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            if let Some(stdin) = child.stdin.as_mut() {
                if let Err(e) = stdin.write_all(text.as_bytes()) {
                    return CallToolResult::error(format!("Failed to write to pbcopy stdin: {e}"));
                }
            }
            match child.wait() {
                Ok(status) if status.success() => {
                    CallToolResult::text(format!("Wrote {} bytes to clipboard", text.len()))
                }
                Ok(status) => CallToolResult::error(format!("pbcopy exited with: {status}")),
                Err(e) => CallToolResult::error(format!("Failed to wait for pbcopy: {e}")),
            }
        }
        Err(e) => CallToolResult::error(format!("Failed to spawn pbcopy: {e}")),
    }
}
