use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct FileSearchProvider;

impl FileSearchProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for FileSearchProvider {
    fn id(&self) -> &str {
        "file_search"
    }

    fn name(&self) -> &str {
        "File Search"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "file_search".into(),
                description: "Search for files using macOS Spotlight (mdfind). Supports Spotlight query syntax.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Spotlight search query (e.g. 'kMDItemKind == \"PDF Document\"' or just 'meeting notes')"
                        },
                        "path": {
                            "type": "string",
                            "description": "Optional directory to restrict search to"
                        },
                        "limit": {
                            "type": "number",
                            "description": "Maximum number of results to return (default: 20)"
                        }
                    },
                    "required": ["query"]
                }),
            },
            Tool {
                name: "file_metadata".into(),
                description: "Get Spotlight metadata attributes for a file (creation date, content type, dimensions, etc).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the file"
                        }
                    },
                    "required": ["path"]
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "file_search" => {
                let query = arguments["query"].as_str().unwrap_or("");
                if query.is_empty() {
                    return Some(CallToolResult::error("Missing required parameter: query"));
                }
                let path = arguments["path"].as_str();
                let limit = arguments["limit"].as_u64().unwrap_or(20) as usize;
                Some(file_search(query, path, limit))
            }
            "file_metadata" => {
                let path = arguments["path"].as_str().unwrap_or("");
                if path.is_empty() {
                    return Some(CallToolResult::error("Missing required parameter: path"));
                }
                Some(file_metadata(path))
            }
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn file_search(query: &str, path: Option<&str>, limit: usize) -> CallToolResult {
    crate::platform::macos::file_search::search(query, path, limit)
}

#[cfg(target_os = "macos")]
fn file_metadata(path: &str) -> CallToolResult {
    crate::platform::macos::file_search::metadata(path)
}

#[cfg(not(target_os = "macos"))]
fn file_search(_query: &str, _path: Option<&str>, _limit: usize) -> CallToolResult {
    CallToolResult::error("File search not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn file_metadata(_path: &str) -> CallToolResult {
    CallToolResult::error("File search not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(FileSearchProvider::new())
}
