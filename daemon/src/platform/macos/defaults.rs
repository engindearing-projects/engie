use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Returns true if the string is safe to pass as a CLI argument
/// (no shell metacharacters that could enable injection).
fn is_safe(s: &str) -> bool {
    !s.contains(';') && !s.contains('|') && !s.contains('&')
    && !s.contains('$') && !s.contains('`') && !s.contains('\n')
}

/// Read a defaults value for a domain and optional key.
pub fn read_default(domain: &str, key: Option<&str>) -> CallToolResult {
    if !is_safe(domain) {
        return CallToolResult::error("Domain contains unsafe characters");
    }
    if let Some(k) = key {
        if !is_safe(k) {
            return CallToolResult::error("Key contains unsafe characters");
        }
    }

    let mut cmd = Command::new("defaults");
    cmd.arg("read").arg(domain);
    if let Some(k) = key {
        cmd.arg(k);
    }

    match cmd.output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("defaults read failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            CallToolResult::text(raw.trim())
        }
        Err(e) => CallToolResult::error(format!("Failed to run defaults: {e}")),
    }
}

/// Write a defaults value with a given type.
pub fn write_default(domain: &str, key: &str, value_type: &str, value: &str) -> CallToolResult {
    if !is_safe(domain) {
        return CallToolResult::error("Domain contains unsafe characters");
    }
    if !is_safe(key) {
        return CallToolResult::error("Key contains unsafe characters");
    }
    if !is_safe(value) {
        return CallToolResult::error("Value contains unsafe characters");
    }

    let type_flag = match value_type {
        "string" => "-string",
        "int" => "-int",
        "float" => "-float",
        "bool" => "-bool",
        _ => {
            return CallToolResult::error(format!(
                "Invalid value_type '{value_type}'. Must be one of: string, int, float, bool"
            ));
        }
    };

    let normalized_value = if value_type == "bool" {
        match value.to_lowercase().as_str() {
            "true" | "yes" | "1" => "TRUE".to_string(),
            "false" | "no" | "0" => "FALSE".to_string(),
            _ => {
                return CallToolResult::error(format!(
                    "Invalid bool value '{value}'. Must be one of: true, false, yes, no, 1, 0"
                ));
            }
        }
    } else {
        value.to_string()
    };

    match Command::new("defaults")
        .args(["write", domain, key, type_flag, &normalized_value])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("defaults write failed: {stderr}"));
            }
            CallToolResult::text(format!("Wrote {domain} {key} = {normalized_value} ({value_type})"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run defaults: {e}")),
    }
}

/// Delete a defaults key from a domain.
pub fn delete_default(domain: &str, key: &str) -> CallToolResult {
    if !is_safe(domain) {
        return CallToolResult::error("Domain contains unsafe characters");
    }
    if !is_safe(key) {
        return CallToolResult::error("Key contains unsafe characters");
    }

    match Command::new("defaults")
        .args(["delete", domain, key])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("defaults delete failed: {stderr}"));
            }
            CallToolResult::text(format!("Deleted {domain} {key}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run defaults: {e}")),
    }
}

/// List all defaults domains as a JSON array.
pub fn list_domains() -> CallToolResult {
    match Command::new("defaults")
        .arg("domains")
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("defaults domains failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            let domains: Vec<&str> = raw
                .trim()
                .split(", ")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();
            let json_array = json!(domains);
            CallToolResult::json(&json_array)
        }
        Err(e) => CallToolResult::error(format!("Failed to run defaults: {e}")),
    }
}

/// Search all defaults for a keyword. Truncates output to 100 lines.
pub fn find_default(keyword: &str) -> CallToolResult {
    if !is_safe(keyword) {
        return CallToolResult::error("Keyword contains unsafe characters");
    }

    match Command::new("defaults")
        .args(["find", keyword])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("defaults find failed: {stderr}"));
            }
            let raw = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = raw.lines().collect();
            let truncated = if lines.len() > 100 {
                let mut result = lines[..100].join("\n");
                result.push_str(&format!("\n\n... truncated ({} total lines)", lines.len()));
                result
            } else {
                raw.trim().to_string()
            };
            CallToolResult::text(truncated)
        }
        Err(e) => CallToolResult::error(format!("Failed to run defaults: {e}")),
    }
}
