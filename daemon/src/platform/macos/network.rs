use std::process::Command;
use serde_json::json;
use crate::mcp::types::CallToolResult;

/// Get network information: hostname, local IPs, public IP, gateway, DNS.
pub fn get_info() -> CallToolResult {
    let mut info = json!({});

    // Hostname
    match Command::new("hostname").output() {
        Ok(output) if output.status.success() => {
            info["hostname"] = json!(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        _ => {
            info["hostname"] = json!(null);
        }
    }

    // Local IPs from ifconfig
    let mut local_ips: Vec<String> = Vec::new();
    if let Ok(output) = Command::new("ifconfig").output() {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout);
            for line in raw.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("inet ") {
                    let ip = rest.split_whitespace().next().unwrap_or("");
                    if !ip.is_empty() && ip != "127.0.0.1" {
                        local_ips.push(ip.to_string());
                    }
                }
            }
        }
    }
    info["local_ips"] = json!(local_ips);

    // Public IP via curl ifconfig.me (short timeout)
    match Command::new("curl")
        .args(["-s", "--max-time", "5", "https://ifconfig.me"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ip.is_empty() {
                info["public_ip"] = json!(ip);
            } else {
                info["public_ip"] = json!(null);
            }
        }
        _ => {
            info["public_ip"] = json!(null);
        }
    }

    // Default gateway via `route get default`
    match Command::new("route").args(["get", "default"]).output() {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout);
            let mut gateway = None;
            for line in raw.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("gateway:") {
                    gateway = Some(rest.trim().to_string());
                    break;
                }
            }
            info["default_gateway"] = json!(gateway);
        }
        _ => {
            info["default_gateway"] = json!(null);
        }
    }

    // DNS servers via scutil
    match Command::new("scutil").args(["--dns"]).output() {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout);
            let mut dns_servers: Vec<String> = Vec::new();
            // Take first 30 lines as requested
            for line in raw.lines().take(30) {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("nameserver[") {
                    // Format: nameserver[0] : 192.168.1.1
                    if let Some((_idx, addr)) = rest.split_once("] : ") {
                        let addr = addr.trim().to_string();
                        if !dns_servers.contains(&addr) {
                            dns_servers.push(addr);
                        }
                    }
                }
            }
            info["dns_servers"] = json!(dns_servers);
        }
        _ => {
            info["dns_servers"] = json!([]);
        }
    }

    CallToolResult::json(&info)
}

/// Get current WiFi connection details via system_profiler and networksetup.
pub fn get_wifi() -> CallToolResult {
    let interface = get_wifi_interface().unwrap_or_else(|| "en0".into());

    // Use system_profiler as primary source (networksetup redacts SSID on macOS 15+)
    let output = match Command::new("system_profiler")
        .args(["SPAirPortDataType"])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return CallToolResult::error("Failed to query WiFi via system_profiler"),
    };

    // Check connection status
    if !output.contains("Status: Connected") {
        return CallToolResult::text("WiFi is off or not connected to any network.");
    }

    let mut info = json!({ "interface": interface, "status": "connected" });

    // Extract SSID from "Current Network Information:" section
    // Format: "Current Network Information:\n            NetworkName:\n"
    let mut in_current_network = false;
    let mut found_ssid = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed == "Current Network Information:" {
            in_current_network = true;
            continue;
        }
        if in_current_network && !found_ssid {
            // First non-empty line after header is the SSID (with trailing colon)
            if !trimmed.is_empty() {
                if let Some(ssid) = trimmed.strip_suffix(':') {
                    info["ssid"] = json!(ssid);
                }
                found_ssid = true;
                continue;
            }
        }
        if found_ssid && in_current_network {
            if trimmed == "Other Local Wi-Fi Networks:" || trimmed.is_empty() {
                break;
            }
            if let Some((key, value)) = trimmed.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                match key {
                    "PHY Mode" => { info["phy_mode"] = json!(value); }
                    "Channel" => { info["channel"] = json!(value); }
                    "Security" => { info["security"] = json!(value); }
                    "Signal / Noise" => {
                        let parts: Vec<&str> = value.split('/').collect();
                        if let Some(sig) = parts.first() {
                            if let Ok(n) = sig.trim().replace(" dBm", "").parse::<i64>() {
                                info["signal_dbm"] = json!(n);
                            }
                        }
                        if let Some(noise) = parts.get(1) {
                            if let Ok(n) = noise.trim().replace(" dBm", "").parse::<i64>() {
                                info["noise_dbm"] = json!(n);
                            }
                        }
                    }
                    "Transmit Rate" => { info["tx_rate"] = json!(value); }
                    "Network Type" => { info["network_type"] = json!(value); }
                    _ => {}
                }
            }
        }
    }

    // Grab MAC address from the interface section
    let mut in_iface = false;
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&format!("{interface}:")) {
            in_iface = true;
            continue;
        }
        if in_iface {
            if let Some((key, value)) = trimmed.split_once(':') {
                if key.trim() == "MAC Address" {
                    info["mac_address"] = json!(value.trim());
                    break;
                }
            }
        }
    }

    CallToolResult::json(&info)
}

/// Find the WiFi interface name via networksetup.
fn get_wifi_interface() -> Option<String> {
    let output = Command::new("networksetup")
        .args(["-listallhardwareports"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let mut found_wifi = false;
    for line in raw.lines() {
        if line.contains("Wi-Fi") || line.contains("AirPort") {
            found_wifi = true;
            continue;
        }
        if found_wifi {
            if let Some(rest) = line.strip_prefix("Device:") {
                return Some(rest.trim().to_string());
            }
        }
    }
    None
}

/// Ping a host with a given count. Validates host to prevent command injection.
pub fn ping(host: &str, count: u32) -> CallToolResult {
    let host = host.trim();

    if host.is_empty() {
        return CallToolResult::error("Host parameter is required.");
    }

    // Command injection prevention: reject dangerous characters
    const FORBIDDEN: &[char] = &[';', '|', '&', '$', '`', '\n', '\r'];
    if host.chars().any(|c| FORBIDDEN.contains(&c)) {
        return CallToolResult::error(
            "Invalid host: contains forbidden characters (; | & $ ` or newlines).",
        );
    }

    let count = count.max(1).min(100);
    let count_str = count.to_string();

    match Command::new("ping")
        .args(["-c", &count_str, "-t", "5", host])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if !output.status.success() && stdout.trim().is_empty() {
                return CallToolResult::error(format!(
                    "Ping failed: {}",
                    if stderr.trim().is_empty() {
                        "unknown error"
                    } else {
                        stderr.trim()
                    }
                ));
            }

            // Return full output (stdout may contain partial results even on failure)
            let mut result = stdout.to_string();
            if !stderr.trim().is_empty() {
                result.push_str(&format!("\n{stderr}"));
            }
            CallToolResult::text(result.trim())
        }
        Err(e) => CallToolResult::error(format!("Failed to run ping: {e}")),
    }
}

/// List all network interfaces with their IPs, MAC addresses, and status.
pub fn get_interfaces() -> CallToolResult {
    match Command::new("ifconfig").output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("ifconfig failed: {stderr}"));
            }

            let raw = String::from_utf8_lossy(&output.stdout);
            let mut interfaces: Vec<serde_json::Value> = Vec::new();
            let mut current_name: Option<String> = None;
            let mut current_flags = String::new();
            let mut current_is_up = false;
            let mut current_inet: Vec<String> = Vec::new();
            let mut current_inet6: Vec<String> = Vec::new();
            let mut current_mac: Option<String> = None;

            let flush = |name: &Option<String>,
                         flags: &str,
                         is_up: bool,
                         inet: &[String],
                         inet6: &[String],
                         mac: &Option<String>,
                         interfaces: &mut Vec<serde_json::Value>| {
                if let Some(iface_name) = name {
                    interfaces.push(json!({
                        "name": iface_name,
                        "flags": flags,
                        "up": is_up,
                        "inet": inet,
                        "inet6": inet6,
                        "mac": mac,
                    }));
                }
            };

            for line in raw.lines() {
                // Interface header line: "en0: flags=8863<UP,...> mtu 1500"
                if !line.starts_with('\t') && !line.starts_with(' ') && line.contains(": flags=")
                {
                    // Flush previous interface
                    flush(
                        &current_name,
                        &current_flags,
                        current_is_up,
                        &current_inet,
                        &current_inet6,
                        &current_mac,
                        &mut interfaces,
                    );

                    let iface_name = line.split(':').next().unwrap_or("").to_string();
                    current_name = Some(iface_name);

                    // Extract flags string
                    if let Some(flags_start) = line.find("flags=") {
                        let flags_rest = &line[flags_start..];
                        if let Some(end) = flags_rest.find(' ') {
                            current_flags = flags_rest[..end].to_string();
                        } else {
                            current_flags = flags_rest.to_string();
                        }
                    } else {
                        current_flags = String::new();
                    }

                    current_is_up = line.contains("<UP") || line.contains(",UP,") || line.contains(",UP>");
                    current_inet = Vec::new();
                    current_inet6 = Vec::new();
                    current_mac = None;
                } else {
                    let trimmed = line.trim();
                    if let Some(rest) = trimmed.strip_prefix("inet ") {
                        let ip = rest.split_whitespace().next().unwrap_or("");
                        if !ip.is_empty() {
                            current_inet.push(ip.to_string());
                        }
                    } else if let Some(rest) = trimmed.strip_prefix("inet6 ") {
                        let ip = rest.split_whitespace().next().unwrap_or("");
                        // Strip %scope_id suffix for cleaner display
                        let ip = ip.split('%').next().unwrap_or(ip);
                        if !ip.is_empty() {
                            current_inet6.push(ip.to_string());
                        }
                    } else if let Some(rest) = trimmed.strip_prefix("ether ") {
                        let mac = rest.split_whitespace().next().unwrap_or("");
                        if !mac.is_empty() {
                            current_mac = Some(mac.to_string());
                        }
                    }
                }
            }

            // Flush last interface
            flush(
                &current_name,
                &current_flags,
                current_is_up,
                &current_inet,
                &current_inet6,
                &current_mac,
                &mut interfaces,
            );

            CallToolResult::json(&json!(interfaces))
        }
        Err(e) => CallToolResult::error(format!("Failed to run ifconfig: {e}")),
    }
}
