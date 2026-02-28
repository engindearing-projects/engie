use std::fs;
use std::path::Path;
use std::process::Command;
use serde_json::{json, Value};
use crate::mcp::types::CallToolResult;

/// List files in a directory.
pub fn list_dir(path: &str, show_hidden: bool) -> CallToolResult {
    let dir = Path::new(path);
    if !dir.exists() {
        return CallToolResult::error(format!("Path does not exist: {path}"));
    }
    if !dir.is_dir() {
        return CallToolResult::error(format!("Not a directory: {path}"));
    }

    match fs::read_dir(dir) {
        Ok(entries) => {
            let mut files: Vec<Value> = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !show_hidden && name.starts_with('.') {
                    continue;
                }
                let metadata = entry.metadata().ok();
                let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                files.push(json!({
                    "name": name,
                    "is_dir": is_dir,
                    "size_bytes": size,
                    "path": entry.path().to_string_lossy(),
                }));
            }
            files.sort_by(|a, b| {
                let a_name = a["name"].as_str().unwrap_or("");
                let b_name = b["name"].as_str().unwrap_or("");
                a_name.to_lowercase().cmp(&b_name.to_lowercase())
            });
            CallToolResult::json(&json!({
                "path": path,
                "count": files.len(),
                "entries": files,
            }))
        }
        Err(e) => CallToolResult::error(format!("Failed to read directory: {e}")),
    }
}

/// Create a directory (with parents if needed).
pub fn mkdir(path: &str) -> CallToolResult {
    match fs::create_dir_all(path) {
        Ok(()) => CallToolResult::text(format!("Created directory: {path}")),
        Err(e) => CallToolResult::error(format!("Failed to create directory: {e}")),
    }
}

/// Move/rename a file or directory.
pub fn move_file(source: &str, destination: &str) -> CallToolResult {
    let src = Path::new(source);
    if !src.exists() {
        return CallToolResult::error(format!("Source does not exist: {source}"));
    }

    let dst = Path::new(destination);
    // If destination is a directory, move into it keeping the filename
    let final_dst = if dst.is_dir() {
        dst.join(src.file_name().unwrap_or_default())
    } else {
        dst.to_path_buf()
    };

    match fs::rename(src, &final_dst) {
        Ok(()) => CallToolResult::text(format!(
            "Moved {} → {}",
            source,
            final_dst.to_string_lossy()
        )),
        Err(_) => {
            // rename fails across mount points, fall back to cp + rm
            match Command::new("mv")
                .args([source, &final_dst.to_string_lossy()])
                .output()
            {
                Ok(output) if output.status.success() => CallToolResult::text(format!(
                    "Moved {} → {}",
                    source,
                    final_dst.to_string_lossy()
                )),
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CallToolResult::error(format!("mv failed: {stderr}"))
                }
                Err(e) => CallToolResult::error(format!("Failed to move: {e}")),
            }
        }
    }
}

/// Copy a file or directory.
pub fn copy_file(source: &str, destination: &str) -> CallToolResult {
    let src = Path::new(source);
    if !src.exists() {
        return CallToolResult::error(format!("Source does not exist: {source}"));
    }

    let flag = if src.is_dir() { "-R" } else { "" };
    let mut args = vec![];
    if !flag.is_empty() {
        args.push(flag);
    }
    args.push(source);
    args.push(destination);

    match Command::new("cp").args(&args).output() {
        Ok(output) if output.status.success() => {
            CallToolResult::text(format!("Copied {source} → {destination}"))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("cp failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to copy: {e}")),
    }
}

/// Reveal a file in Finder.
pub fn reveal_in_finder(path: &str) -> CallToolResult {
    match Command::new("open").args(["-R", path]).output() {
        Ok(output) if output.status.success() => {
            CallToolResult::text(format!("Revealed in Finder: {path}"))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("Failed to reveal: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to reveal: {e}")),
    }
}

/// Trash a file (move to macOS Trash instead of permanent delete).
pub fn trash(path: &str) -> CallToolResult {
    let p = Path::new(path);
    if !p.exists() {
        return CallToolResult::error(format!("Path does not exist: {path}"));
    }

    // Use Finder's "move to trash" via osascript for safety
    let script = format!(
        "tell application \"Finder\" to delete POSIX file \"{}\"",
        path.replace('"', "'")
    );

    match Command::new("osascript").args(["-e", &script]).output() {
        Ok(output) if output.status.success() => {
            CallToolResult::text(format!("Moved to Trash: {path}"))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            CallToolResult::error(format!("Failed to trash: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to trash: {e}")),
    }
}
