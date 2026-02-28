use std::io::{self, BufRead, Write};

use serde_json::{json, Value};
use tracing::{debug, error, info, warn};

use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use super::types::*;
use crate::capabilities::CapabilityRegistry;
use crate::config::FamiliarConfig;

/// Run the MCP server: read JSON-RPC from stdin, write responses to stdout.
/// All logging goes to stderr.
pub fn run(registry: CapabilityRegistry, config: &FamiliarConfig) {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    info!(
        tools = registry.tool_count(),
        capabilities = registry.capability_count(),
        "familiar-daemon MCP server started"
    );

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                error!("stdin read error: {e}");
                break;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Try to parse as a request (has 'id')
        let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
            Ok(req) => handle_request(&registry, config, req),
            Err(_) => {
                // Might be a notification (no id) — check for method
                if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                    if val.get("method").is_some() && val.get("id").is_none() {
                        let method = val["method"].as_str().unwrap_or("unknown");
                        debug!("notification: {method}");
                        continue; // notifications don't get responses
                    }
                }
                warn!("unparseable message: {trimmed}");
                continue;
            }
        };

        if let Some(resp) = response {
            let json = serde_json::to_string(&resp).expect("failed to serialize response");
            let _ = writeln!(stdout, "{json}");
            let _ = stdout.flush();
        }
    }

    info!("stdin closed, shutting down");
}

fn handle_request(registry: &CapabilityRegistry, config: &FamiliarConfig, req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    debug!(method = %req.method, "request");

    match req.method.as_str() {
        "initialize" => {
            let result = InitializeResult {
                protocol_version: "2024-11-05".into(),
                capabilities: ServerCapabilities {
                    tools: ToolsCapability { list_changed: true },
                },
                server_info: ServerInfo {
                    name: config.identity.name.clone(),
                    version: env!("CARGO_PKG_VERSION").into(),
                },
            };
            Some(JsonRpcResponse::success(
                req.id,
                serde_json::to_value(result).unwrap(),
            ))
        }

        "ping" => Some(JsonRpcResponse::success(req.id, Value::Object(Default::default()))),

        "tools/list" => {
            let mut tools = registry.list_tools();
            // Add the workflow_run meta-tool
            tools.push(workflow_tool_definition());
            let result = serde_json::json!({ "tools": tools });
            Some(JsonRpcResponse::success(req.id, result))
        }

        "tools/call" => {
            let params: CallToolParams = match serde_json::from_value(req.params) {
                Ok(p) => p,
                Err(e) => {
                    return Some(JsonRpcResponse::error(
                        req.id,
                        -32602,
                        format!("Invalid params: {e}"),
                    ));
                }
            };

            let result = if params.name == "workflow_run" {
                execute_workflow(registry, &params.arguments)
            } else {
                registry.call_tool(&params.name, &params.arguments)
            };
            Some(JsonRpcResponse::success(
                req.id,
                serde_json::to_value(result).unwrap(),
            ))
        }

        _ => {
            warn!(method = %req.method, "unknown method");
            Some(JsonRpcResponse::error(
                req.id,
                -32601,
                format!("Method not found: {}", req.method),
            ))
        }
    }
}

// ── Workflow Meta-Tool ─────────────────────────────────────────────────────

fn workflow_tool_definition() -> Tool {
    Tool {
        name: "workflow_run".into(),
        description: "Execute a sequence of daemon tools atomically with variable passing between steps. Each step's result is stored in its output_var and available as $var_name in subsequent step arguments.".into(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool": {
                                "type": "string",
                                "description": "Tool name to call"
                            },
                            "arguments": {
                                "type": "object",
                                "description": "Arguments to pass to the tool. Use $var_name to reference previous step outputs."
                            },
                            "output_var": {
                                "type": "string",
                                "description": "Variable name to store this step's result (optional)"
                            }
                        },
                        "required": ["tool"]
                    },
                    "description": "Ordered list of tool calls to execute"
                }
            },
            "required": ["steps"]
        }),
    }
}

fn execute_workflow(registry: &CapabilityRegistry, arguments: &Value) -> CallToolResult {
    let steps = match arguments["steps"].as_array() {
        Some(s) => s,
        None => return CallToolResult::error("'steps' must be an array"),
    };

    if steps.is_empty() {
        return CallToolResult::error("'steps' array is empty");
    }

    if steps.len() > 20 {
        return CallToolResult::error("Workflow limited to 20 steps maximum");
    }

    let mut vars: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let mut step_results: Vec<Value> = Vec::new();

    for (i, step) in steps.iter().enumerate() {
        let tool_name = match step["tool"].as_str() {
            Some(t) => t,
            None => return CallToolResult::error(format!("Step {}: 'tool' must be a string", i + 1)),
        };

        // Don't allow recursive workflow calls
        if tool_name == "workflow_run" {
            return CallToolResult::error(format!("Step {}: recursive workflow_run not allowed", i + 1));
        }

        let mut tool_args = step.get("arguments").cloned().unwrap_or(json!({}));

        // Substitute $var_name references in string arguments
        substitute_vars(&mut tool_args, &vars);

        debug!(step = i + 1, tool = tool_name, "workflow step");
        let result = registry.call_tool(tool_name, &tool_args);

        // Extract text from result content
        let text_output: String = result
            .content
            .iter()
            .filter_map(|c| match c {
                super::types::ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");

        let is_error = result.is_error.unwrap_or(false);

        // Store in output_var if specified
        if let Some(var_name) = step["output_var"].as_str() {
            // Try to parse as JSON, fall back to string value
            let var_value = serde_json::from_str::<Value>(&text_output)
                .unwrap_or_else(|_| json!(text_output));
            vars.insert(var_name.to_string(), var_value);
        }

        step_results.push(json!({
            "step": i + 1,
            "tool": tool_name,
            "output": text_output,
            "is_error": is_error,
        }));

        // Stop on error
        if is_error {
            return CallToolResult::json(&json!({
                "completed_steps": i + 1,
                "total_steps": steps.len(),
                "stopped_on_error": true,
                "results": step_results,
            }));
        }
    }

    CallToolResult::json(&json!({
        "completed_steps": steps.len(),
        "total_steps": steps.len(),
        "results": step_results,
    }))
}

/// Recursively substitute $var_name references in argument values.
fn substitute_vars(value: &mut Value, vars: &std::collections::HashMap<String, Value>) {
    match value {
        Value::String(s) => {
            // Check if the entire string is a variable reference
            if s.starts_with('$') && !s.contains(' ') {
                let var_name = &s[1..];
                if let Some(var_val) = vars.get(var_name) {
                    *value = var_val.clone();
                    return;
                }
            }
            // Otherwise do string interpolation for $var within text
            for (var_name, var_val) in vars {
                let placeholder = format!("${var_name}");
                if s.contains(&placeholder) {
                    let replacement = match var_val {
                        Value::String(sv) => sv.clone(),
                        other => other.to_string(),
                    };
                    *s = s.replace(&placeholder, &replacement);
                }
            }
        }
        Value::Object(map) => {
            for val in map.values_mut() {
                substitute_vars(val, vars);
            }
        }
        Value::Array(arr) => {
            for val in arr.iter_mut() {
                substitute_vars(val, vars);
            }
        }
        _ => {}
    }
}
