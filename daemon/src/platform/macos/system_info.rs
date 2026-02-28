// macOS-specific system info extensions.
// The main system_info capability uses the cross-platform sysinfo crate.
// This module adds macOS-only features like battery via IOKit.

use std::process::Command;

/// Get battery info via `pmset -g batt` (simplest reliable approach on macOS).
pub fn get_battery() -> Option<(f64, bool)> {
    let output = Command::new("pmset")
        .args(["-g", "batt"])
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);

    // Parse percentage from output like: "InternalBattery-0 (id=...)	85%; charging; ..."
    let pct = text
        .lines()
        .find(|l| l.contains("InternalBattery"))?
        .split('\t')
        .nth(1)?
        .split('%')
        .next()?
        .trim()
        .parse::<f64>()
        .ok()?;

    let charging = text.contains("charging") && !text.contains("not charging");

    Some((pct, charging))
}
