use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct FileOpsProvider;

impl CapabilityProvider for FileOpsProvider {
    fn id(&self) -> &str { "file_ops" }
    fn name(&self) -> &str { "File Operations" }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "file_list".into(),
                description: "List files and directories at a path.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path to list" },
                        "show_hidden": { "type": "boolean", "description": "Include hidden files (default: false)" }
                    },
                    "required": ["path"],
                }),
            },
            Tool {
                name: "file_mkdir".into(),
                description: "Create a directory (and parent directories if needed).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path to create" }
                    },
                    "required": ["path"],
                }),
            },
            Tool {
                name: "file_move".into(),
                description: "Move or rename a file or directory.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Source file/directory path" },
                        "destination": { "type": "string", "description": "Destination path (directory or new name)" }
                    },
                    "required": ["source", "destination"],
                }),
            },
            Tool {
                name: "file_copy".into(),
                description: "Copy a file or directory.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Source file/directory path" },
                        "destination": { "type": "string", "description": "Destination path" }
                    },
                    "required": ["source", "destination"],
                }),
            },
            Tool {
                name: "file_trash".into(),
                description: "Move a file to the macOS Trash (safe delete).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File or directory to trash" }
                    },
                    "required": ["path"],
                }),
            },
            Tool {
                name: "file_reveal".into(),
                description: "Reveal a file or directory in Finder.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path to reveal in Finder" }
                    },
                    "required": ["path"],
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "file_list" => {
                let path = arguments["path"].as_str()?;
                let show_hidden = arguments["show_hidden"].as_bool().unwrap_or(false);
                Some(dispatch_list(path, show_hidden))
            }
            "file_mkdir" => {
                let path = arguments["path"].as_str()?;
                Some(dispatch_mkdir(path))
            }
            "file_move" => {
                let source = arguments["source"].as_str()?;
                let destination = arguments["destination"].as_str()?;
                Some(dispatch_move(source, destination))
            }
            "file_copy" => {
                let source = arguments["source"].as_str()?;
                let destination = arguments["destination"].as_str()?;
                Some(dispatch_copy(source, destination))
            }
            "file_trash" => {
                let path = arguments["path"].as_str()?;
                Some(dispatch_trash(path))
            }
            "file_reveal" => {
                let path = arguments["path"].as_str()?;
                Some(dispatch_reveal(path))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn dispatch_list(path: &str, show_hidden: bool) -> CallToolResult {
    crate::platform::macos::file_ops::list_dir(path, show_hidden)
}
#[cfg(target_os = "macos")]
fn dispatch_mkdir(path: &str) -> CallToolResult {
    crate::platform::macos::file_ops::mkdir(path)
}
#[cfg(target_os = "macos")]
fn dispatch_move(source: &str, destination: &str) -> CallToolResult {
    crate::platform::macos::file_ops::move_file(source, destination)
}
#[cfg(target_os = "macos")]
fn dispatch_copy(source: &str, destination: &str) -> CallToolResult {
    crate::platform::macos::file_ops::copy_file(source, destination)
}
#[cfg(target_os = "macos")]
fn dispatch_trash(path: &str) -> CallToolResult {
    crate::platform::macos::file_ops::trash(path)
}
#[cfg(target_os = "macos")]
fn dispatch_reveal(path: &str) -> CallToolResult {
    crate::platform::macos::file_ops::reveal_in_finder(path)
}

#[cfg(not(target_os = "macos"))]
fn dispatch_list(_: &str, _: bool) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }
#[cfg(not(target_os = "macos"))]
fn dispatch_mkdir(_: &str) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }
#[cfg(not(target_os = "macos"))]
fn dispatch_move(_: &str, _: &str) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }
#[cfg(not(target_os = "macos"))]
fn dispatch_copy(_: &str, _: &str) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }
#[cfg(not(target_os = "macos"))]
fn dispatch_trash(_: &str) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }
#[cfg(not(target_os = "macos"))]
fn dispatch_reveal(_: &str) -> CallToolResult { CallToolResult::error("file_ops not supported on this platform") }

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(FileOpsProvider)
}
