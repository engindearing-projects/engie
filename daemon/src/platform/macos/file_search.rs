use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Search for files using Spotlight (`mdfind`).
pub fn search(query: &str, path: Option<&str>, limit: usize) -> CallToolResult {
    let mut cmd = Command::new("mdfind");

    if let Some(dir) = path {
        cmd.args(["-onlyin", dir]);
    }

    cmd.arg(query);

    match cmd.output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("mdfind failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            let results: Vec<&str> = raw
                .lines()
                .filter(|l| !l.is_empty())
                .take(limit)
                .collect();
            let total_matches = raw.lines().filter(|l| !l.is_empty()).count();
            CallToolResult::json(&json!({
                "results": results,
                "count": results.len(),
                "total_matches": total_matches,
            }))
        }
        Err(e) => CallToolResult::error(format!("Failed to run mdfind: {e}")),
    }
}

/// Get file metadata using Spotlight (`mdls`).
pub fn metadata(path: &str) -> CallToolResult {
    match Command::new("mdls").arg(path).output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("mdls failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            let mut result = json!({});
            for line in raw.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    let key = key.trim();
                    let value = value.trim();
                    // Try to parse as JSON value (handles numbers, strings, null, arrays)
                    if value == "(null)" {
                        result[key] = json!(null);
                    } else if value == "(" {
                        // Start of a multi-line array — skip, will be captured below
                        continue;
                    } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
                        result[key] = parsed;
                    } else {
                        // Strip surrounding quotes if present
                        let cleaned = value.trim_matches('"');
                        result[key] = json!(cleaned);
                    }
                }
            }
            // Second pass: capture multi-line array values
            let mut current_key: Option<String> = None;
            let mut current_values: Vec<String> = Vec::new();
            for line in raw.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    // Flush previous array if any
                    if let Some(ref k) = current_key {
                        result[k.as_str()] = json!(current_values);
                        current_values.clear();
                    }
                    let value = value.trim();
                    if value == "(" {
                        current_key = Some(key.trim().to_string());
                    } else {
                        current_key = None;
                    }
                } else if current_key.is_some() {
                    let trimmed = line.trim();
                    if trimmed == ")" {
                        if let Some(ref k) = current_key {
                            result[k.as_str()] = json!(current_values);
                        }
                        current_values.clear();
                        current_key = None;
                    } else {
                        // Strip trailing comma and surrounding quotes
                        let cleaned = trimmed
                            .trim_end_matches(',')
                            .trim()
                            .trim_matches('"');
                        current_values.push(cleaned.to_string());
                    }
                }
            }
            CallToolResult::json(&result)
        }
        Err(e) => CallToolResult::error(format!("Failed to run mdls: {e}")),
    }
}
