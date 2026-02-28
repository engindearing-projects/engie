use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Characters that are rejected from URLs to prevent command injection.
const FORBIDDEN_CHARS: &[char] = &['"', '`', '$', ';', '|', '&'];

/// Validate a URL: must start with http://, https://, or file:// and must not
/// contain any characters that could be used for shell injection.
fn validate_url(url: &str) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("file://") {
        return Err("URL must start with http://, https://, or file://".into());
    }
    if let Some(c) = url.chars().find(|c| FORBIDDEN_CHARS.contains(c)) {
        return Err(format!("URL contains forbidden character: {c}"));
    }
    Ok(())
}

/// Open a URL in the default or specified browser.
pub fn open_url(url: &str, browser: Option<&str>) -> CallToolResult {
    if let Err(msg) = validate_url(url) {
        return CallToolResult::error(msg);
    }

    let output = if let Some(browser_name) = browser {
        Command::new("open")
            .args(["-a", browser_name, url])
            .output()
    } else {
        Command::new("open")
            .arg(url)
            .output()
    };

    match output {
        Ok(out) => {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                return CallToolResult::error(format!("open command failed: {stderr}"));
            }
            let target = browser.unwrap_or("default browser");
            CallToolResult::text(format!("Opened {url} in {target}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run open: {e}")),
    }
}

/// List all open tabs in the specified browser (or try Safari then Chrome).
pub fn get_tabs(browser: Option<&str>) -> CallToolResult {
    let browsers: Vec<&str> = match browser {
        Some(b) => vec![b],
        None => vec!["Safari", "Google Chrome"],
    };

    for browser_name in &browsers {
        let script = match *browser_name {
            "Safari" => r#"tell application "Safari"
  set tabList to {}
  repeat with w in windows
    repeat with t in tabs of w
      set end of tabList to {name of t, URL of t}
    end repeat
  end repeat
  return tabList
end tell"#.to_string(),
            "Google Chrome" => r#"tell application "Google Chrome"
  set tabList to {}
  repeat with w in windows
    repeat with t in tabs of w
      set end of tabList to {title of t, URL of t}
    end repeat
  end repeat
  return tabList
end tell"#.to_string(),
            other => format!(
                r#"tell application "{other}"
  set tabList to {{}}
  repeat with w in windows
    repeat with t in tabs of w
      set end of tabList to {{title of t, URL of t}}
    end repeat
  end repeat
  return tabList
end tell"#
            ),
        };

        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(output) => {
                if !output.status.success() {
                    // This browser might not be running; try next one
                    continue;
                }
                let raw = String::from_utf8_lossy(&output.stdout);
                let tabs = parse_tab_list(&raw);
                return CallToolResult::json(&json!({
                    "browser": browser_name,
                    "tabs": tabs
                }));
            }
            Err(_) => continue,
        }
    }

    CallToolResult::error("No supported browser is running (tried Safari, Google Chrome)")
}

/// Get the active (frontmost) tab in the specified browser (or try Safari then Chrome).
pub fn get_active_tab(browser: Option<&str>) -> CallToolResult {
    let browsers: Vec<&str> = match browser {
        Some(b) => vec![b],
        None => vec!["Safari", "Google Chrome"],
    };

    for browser_name in &browsers {
        let script = match *browser_name {
            "Safari" => {
                r#"tell application "Safari" to return {name of current tab of front window, URL of current tab of front window}"#.to_string()
            }
            "Google Chrome" => {
                r#"tell application "Google Chrome" to return {title of active tab of front window, URL of active tab of front window}"#.to_string()
            }
            other => format!(
                r#"tell application "{other}" to return {{title of active tab of front window, URL of active tab of front window}}"#
            ),
        };

        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(output) => {
                if !output.status.success() {
                    continue;
                }
                let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let (title, url) = parse_single_tab(&raw);
                return CallToolResult::json(&json!({
                    "browser": browser_name,
                    "title": title,
                    "url": url
                }));
            }
            Err(_) => continue,
        }
    }

    CallToolResult::error("No supported browser is running (tried Safari, Google Chrome)")
}

/// Parse the AppleScript tab list output into a JSON array of {title, url} objects.
///
/// AppleScript returns comma-separated pairs like:
/// `Tab Title, https://example.com, Another Tab, https://other.com`
fn parse_tab_list(raw: &str) -> Vec<serde_json::Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    let mut tabs = Vec::new();
    // Split by ", " but we need to pair them: every two items form (title, url)
    let parts: Vec<&str> = trimmed.split(", ").collect();

    let mut i = 0;
    while i < parts.len() {
        // Find the URL part: look for the next element starting with http/https/file
        // The title might itself contain ", " so we need to be smart about grouping
        let mut j = i + 1;
        while j < parts.len() {
            let candidate = parts[j].trim();
            if candidate.starts_with("http://")
                || candidate.starts_with("https://")
                || candidate.starts_with("file://")
            {
                break;
            }
            j += 1;
        }

        if j < parts.len() {
            let title = parts[i..j].join(", ");
            let url = parts[j].trim().to_string();
            tabs.push(json!({
                "title": title,
                "url": url
            }));
            i = j + 1;
        } else {
            // No URL found for remaining parts — include as a title-only entry
            let title = parts[i..].join(", ");
            tabs.push(json!({
                "title": title,
                "url": null
            }));
            break;
        }
    }

    tabs
}

/// Parse a single tab pair from AppleScript output: "Title, URL"
fn parse_single_tab(raw: &str) -> (String, String) {
    // Find the last occurrence of ", http" or ", file" to split title from URL
    for prefix in &[", https://", ", http://", ", file://"] {
        if let Some(pos) = raw.rfind(prefix) {
            let title = raw[..pos].to_string();
            let url = raw[pos + 2..].trim().to_string();
            return (title, url);
        }
    }
    // Fallback: try splitting on the last comma
    if let Some(pos) = raw.rfind(", ") {
        let title = raw[..pos].to_string();
        let url = raw[pos + 2..].trim().to_string();
        return (title, url);
    }
    (raw.to_string(), String::new())
}
