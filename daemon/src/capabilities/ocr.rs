use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct OcrProvider;

impl OcrProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for OcrProvider {
    fn id(&self) -> &str {
        "ocr"
    }

    fn name(&self) -> &str {
        "Screen OCR"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "ocr_screen".into(),
                description: "OCR the entire screen. Returns recognized text with bounding boxes and confidence scores.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "display": {
                            "type": "number",
                            "description": "Display index (default: 0 for main display)"
                        }
                    },
                }),
            },
            Tool {
                name: "ocr_region".into(),
                description: "OCR a specific region of the screen. Returns recognized text with bounding boxes.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "x": {
                            "type": "number",
                            "description": "X coordinate of region top-left"
                        },
                        "y": {
                            "type": "number",
                            "description": "Y coordinate of region top-left"
                        },
                        "width": {
                            "type": "number",
                            "description": "Width of region in pixels"
                        },
                        "height": {
                            "type": "number",
                            "description": "Height of region in pixels"
                        }
                    },
                    "required": ["x", "y", "width", "height"]
                }),
            },
            Tool {
                name: "ocr_image".into(),
                description: "OCR an image file. Returns recognized text with bounding boxes.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the image file"
                        }
                    },
                    "required": ["path"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "ocr_screen" => {
                let display = arguments["display"].as_u64().unwrap_or(0) as u32;
                Some(ocr_screen(display))
            }
            "ocr_region" => {
                let x = arguments["x"].as_f64().unwrap_or(0.0);
                let y = arguments["y"].as_f64().unwrap_or(0.0);
                let width = arguments["width"].as_f64().unwrap_or(0.0);
                let height = arguments["height"].as_f64().unwrap_or(0.0);
                Some(ocr_region(x, y, width, height))
            }
            "ocr_image" => {
                let path = arguments["path"].as_str().unwrap_or("");
                Some(ocr_image(path))
            }
            _ => None,
        }
    }
}

// ── Platform dispatch ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn ocr_screen(display: u32) -> CallToolResult {
    crate::platform::macos::ocr::ocr_screen(display)
}

#[cfg(target_os = "macos")]
fn ocr_region(x: f64, y: f64, width: f64, height: f64) -> CallToolResult {
    crate::platform::macos::ocr::ocr_region(x, y, width, height)
}

#[cfg(target_os = "macos")]
fn ocr_image(path: &str) -> CallToolResult {
    crate::platform::macos::ocr::ocr_image(path)
}

#[cfg(not(target_os = "macos"))]
fn ocr_screen(_display: u32) -> CallToolResult {
    CallToolResult::error("OCR not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ocr_region(_x: f64, _y: f64, _width: f64, _height: f64) -> CallToolResult {
    CallToolResult::error("OCR not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn ocr_image(_path: &str) -> CallToolResult {
    CallToolResult::error("OCR not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(OcrProvider::new())
}
