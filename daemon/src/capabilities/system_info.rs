use serde_json::{json, Value};
use sysinfo::{Disks, System};

use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct SystemInfoProvider;

impl SystemInfoProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for SystemInfoProvider {
    fn id(&self) -> &str {
        "system_info"
    }

    fn name(&self) -> &str {
        "System Information"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "system_info".into(),
                description: "Get system information: CPU, memory, disk, battery, OS version, hostname, uptime.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "system_processes".into(),
                description: "List running processes with CPU and memory usage.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "number",
                            "description": "Max processes to return, sorted by CPU usage (default: 20)"
                        }
                    },
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "system_info" => Some(get_system_info()),
            "system_processes" => {
                let limit = arguments["limit"].as_u64().unwrap_or(20) as usize;
                Some(get_processes(limit))
            }
            _ => None,
        }
    }
}

fn get_system_info() -> CallToolResult {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut info = json!({
        "hostname": System::host_name().unwrap_or_default(),
        "os": System::long_os_version().unwrap_or_default(),
        "kernel": System::kernel_version().unwrap_or_default(),
        "uptime_seconds": System::uptime(),
        "cpu": {
            "name": sys.cpus().first().map(|c| c.brand()).unwrap_or("unknown"),
            "cores": sys.cpus().len(),
            "usage_percent": sys.global_cpu_usage(),
        },
        "memory": {
            "total_mb": sys.total_memory() / 1_048_576,
            "used_mb": sys.used_memory() / 1_048_576,
            "available_mb": sys.available_memory() / 1_048_576,
        },
        "swap": {
            "total_mb": sys.total_swap() / 1_048_576,
            "used_mb": sys.used_swap() / 1_048_576,
        },
        "disks": Disks::new_with_refreshed_list().iter().map(|d| json!({
            "name": d.name().to_string_lossy(),
            "mount": d.mount_point().to_string_lossy(),
            "total_gb": d.total_space() as f64 / 1_073_741_824.0,
            "free_gb": d.available_space() as f64 / 1_073_741_824.0,
            "fs": d.file_system().to_string_lossy(),
        })).collect::<Vec<_>>(),
    });

    // Add battery info (macOS only)
    #[cfg(target_os = "macos")]
    if let Some((percent, charging)) = crate::platform::macos::system_info::get_battery() {
        if let Some(obj) = info.as_object_mut() {
            obj.insert("battery".into(), json!({
                "percent": percent,
                "charging": charging,
            }));
        }
    }

    CallToolResult::json(&info)
}

fn get_processes(limit: usize) -> CallToolResult {
    let mut sys = System::new_all();
    sys.refresh_all();

    let mut procs: Vec<_> = sys.processes().values().collect();
    procs.sort_by(|a, b| b.cpu_usage().partial_cmp(&a.cpu_usage()).unwrap_or(std::cmp::Ordering::Equal));

    let list: Vec<_> = procs
        .iter()
        .take(limit)
        .map(|p| {
            json!({
                "pid": p.pid().as_u32(),
                "name": p.name().to_string_lossy(),
                "cpu_percent": format!("{:.1}", p.cpu_usage()),
                "memory_mb": p.memory() / 1_048_576,
            })
        })
        .collect();

    CallToolResult::json(&json!({ "processes": list, "total": sys.processes().len() }))
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(SystemInfoProvider::new())
}
