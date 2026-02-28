use std::path::{Path, PathBuf};
use std::process::Command;
use std::fs;
use serde_json::Value;
use crate::mcp::types::CallToolResult;

/// Get the path to the compiled OCR binary, compiling it if needed.
fn ocr_binary_path() -> Result<PathBuf, String> {
    let scripts_dir = get_scripts_dir()?;
    let swift_source = scripts_dir.join("ocr.swift");
    let binary = scripts_dir.join(".ocr_compiled");

    if !swift_source.exists() {
        return Err(format!("OCR Swift helper not found at {}", swift_source.display()));
    }

    // Recompile if binary doesn't exist or is older than source
    let needs_compile = if binary.exists() {
        let src_modified = fs::metadata(&swift_source)
            .and_then(|m| m.modified())
            .ok();
        let bin_modified = fs::metadata(&binary)
            .and_then(|m| m.modified())
            .ok();
        match (src_modified, bin_modified) {
            (Some(s), Some(b)) => s > b,
            _ => true,
        }
    } else {
        true
    };

    if needs_compile {
        let output = Command::new("swiftc")
            .args([
                "-O",
                "-framework", "Vision",
                "-framework", "AppKit",
                swift_source.to_str().unwrap(),
                "-o", binary.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("Failed to run swiftc: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to compile OCR helper: {stderr}"));
        }
    }

    Ok(binary)
}

/// Find the scripts directory relative to the daemon binary.
fn get_scripts_dir() -> Result<PathBuf, String> {
    // Try the standard location first
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        PathBuf::from(&home).join("engie/familiar-daemon/scripts"),
        PathBuf::from(&home).join("familiar-daemon/scripts"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    Err("Could not find familiar-daemon scripts directory".into())
}

/// Run the OCR binary on an image file and parse the JSON output.
fn run_ocr(image_path: &Path) -> CallToolResult {
    let binary = match ocr_binary_path() {
        Ok(b) => b,
        Err(e) => return CallToolResult::error(e),
    };

    let output = match Command::new(&binary)
        .arg(image_path.to_str().unwrap_or(""))
        .output()
    {
        Ok(o) => o,
        Err(e) => return CallToolResult::error(format!("Failed to run OCR binary: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return CallToolResult::error(format!("OCR failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<Value>(&stdout) {
        Ok(val) => {
            // Check if it's an error response
            if let Some(err) = val.get("error") {
                return CallToolResult::error(err.as_str().unwrap_or("Unknown OCR error").to_string());
            }
            CallToolResult::json(&val)
        }
        Err(_) => CallToolResult::text(stdout.to_string()),
    }
}

// ── OCR Screen ──────────────────────────────────────────────────────────────

pub fn ocr_screen(display: u32) -> CallToolResult {
    // Take a screenshot first, then OCR it
    let tmp_path = format!("/tmp/familiar-ocr-screen-{}.png", std::process::id());

    let output = Command::new("screencapture")
        .args(["-x", "-D", &display.to_string(), &tmp_path])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let result = run_ocr(Path::new(&tmp_path));
            let _ = fs::remove_file(&tmp_path);
            result
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            CallToolResult::error(format!("Screenshot failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run screencapture: {e}")),
    }
}

// ── OCR Region ──────────────────────────────────────────────────────────────

pub fn ocr_region(x: f64, y: f64, width: f64, height: f64) -> CallToolResult {
    let tmp_path = format!("/tmp/familiar-ocr-region-{}.png", std::process::id());
    let rect = format!("{},{},{},{}", x as i32, y as i32, width as i32, height as i32);

    let output = Command::new("screencapture")
        .args(["-x", "-R", &rect, &tmp_path])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let result = run_ocr(Path::new(&tmp_path));
            let _ = fs::remove_file(&tmp_path);
            result
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            CallToolResult::error(format!("Screenshot failed: {stderr}"))
        }
        Err(e) => CallToolResult::error(format!("Failed to run screencapture: {e}")),
    }
}

// ── OCR Image ───────────────────────────────────────────────────────────────

pub fn ocr_image(path: &str) -> CallToolResult {
    let image_path = Path::new(path);
    if !image_path.exists() {
        return CallToolResult::error(format!("Image file not found: {path}"));
    }
    run_ocr(image_path)
}
