use std::process::Command;
use core_foundation::base::{CFRelease, CFTypeRef};

use crate::mcp::types::CallToolResult;
use crate::platform::macos::ax_helpers::{self, AXUIElementRef};
use crate::platform::macos::cg_helpers;

use serde_json::json;

/// List windows, optionally filtered by app name.
pub fn list_windows(app_name: Option<&str>) -> CallToolResult {
    let windows = cg_helpers::list_windows();
    let filtered: Vec<_> = match app_name {
        Some(name) => {
            let name_lower = name.to_lowercase();
            windows
                .into_iter()
                .filter(|w| w.owner_name.to_lowercase().contains(&name_lower))
                .collect()
        }
        None => windows,
    };
    CallToolResult::json(&json!(filtered))
}

/// Focus a window by window ID.
pub fn focus_window(window_id: u32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let win = match cg_helpers::get_window(window_id) {
        Some(w) => w,
        None => return CallToolResult::error(format!("Window {window_id} not found")),
    };

    let app_ref = unsafe { ax_helpers::AXUIElementCreateApplication(win.pid) };
    if app_ref.is_null() {
        return CallToolResult::error("Failed to create AX application element");
    }

    // Raise the app
    let raise_result = ax_helpers::perform_ax_action(app_ref, ax_helpers::AX_RAISE_ACTION);

    // Also try to raise the specific window via AX
    if let Some(ax_win) = find_ax_window(app_ref, &win) {
        let _ = ax_helpers::perform_ax_action(ax_win, ax_helpers::AX_RAISE_ACTION);
        unsafe { CFRelease(ax_win as CFTypeRef) };
    }

    // Activate the process via osascript for reliable frontmost setting
    let script = format!(
        r#"tell application "System Events" to set frontmost of (first process whose unix id is {}) to true"#,
        win.pid
    );
    let _ = Command::new("osascript").arg("-e").arg(&script).output();

    unsafe { CFRelease(app_ref as CFTypeRef) };

    match raise_result {
        Ok(()) => CallToolResult::text(format!(
            "Focused window {} ('{}' - {})",
            window_id, win.title, win.owner_name
        )),
        Err(code) => {
            // Even if AXRaise failed, the osascript fallback may have worked
            CallToolResult::text(format!(
                "Focused window {} ('{}' - {}) (AX raise returned {})",
                window_id, win.title, win.owner_name, code
            ))
        }
    }
}

/// Move a window by window ID to (x, y).
pub fn move_window(window_id: u32, x: f64, y: f64) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let win = match cg_helpers::get_window(window_id) {
        Some(w) => w,
        None => return CallToolResult::error(format!("Window {window_id} not found")),
    };

    let app_ref = unsafe { ax_helpers::AXUIElementCreateApplication(win.pid) };
    if app_ref.is_null() {
        return CallToolResult::error("Failed to create AX application element");
    }

    let result = match find_ax_window(app_ref, &win) {
        Some(ax_win) => {
            let res = ax_helpers::set_ax_position(ax_win, x, y);
            unsafe { CFRelease(ax_win as CFTypeRef) };
            res
        }
        None => {
            unsafe { CFRelease(app_ref as CFTypeRef) };
            return CallToolResult::error(format!(
                "Could not find AX window element for window {window_id}"
            ));
        }
    };

    unsafe { CFRelease(app_ref as CFTypeRef) };

    match result {
        Ok(()) => CallToolResult::text(format!(
            "Moved window {} to ({}, {})",
            window_id, x, y
        )),
        Err(code) => CallToolResult::error(format!(
            "Failed to move window {}: AX error {}",
            window_id, code
        )),
    }
}

/// Resize a window by window ID to (width, height).
pub fn resize_window(window_id: u32, width: f64, height: f64) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let win = match cg_helpers::get_window(window_id) {
        Some(w) => w,
        None => return CallToolResult::error(format!("Window {window_id} not found")),
    };

    let app_ref = unsafe { ax_helpers::AXUIElementCreateApplication(win.pid) };
    if app_ref.is_null() {
        return CallToolResult::error("Failed to create AX application element");
    }

    let result = match find_ax_window(app_ref, &win) {
        Some(ax_win) => {
            let res = ax_helpers::set_ax_size(ax_win, width, height);
            unsafe { CFRelease(ax_win as CFTypeRef) };
            res
        }
        None => {
            unsafe { CFRelease(app_ref as CFTypeRef) };
            return CallToolResult::error(format!(
                "Could not find AX window element for window {window_id}"
            ));
        }
    };

    unsafe { CFRelease(app_ref as CFTypeRef) };

    match result {
        Ok(()) => CallToolResult::text(format!(
            "Resized window {} to {}x{}",
            window_id, width, height
        )),
        Err(code) => CallToolResult::error(format!(
            "Failed to resize window {}: AX error {}",
            window_id, code
        )),
    }
}

/// Minimize a window by window ID.
pub fn minimize_window(window_id: u32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let win = match cg_helpers::get_window(window_id) {
        Some(w) => w,
        None => return CallToolResult::error(format!("Window {window_id} not found")),
    };

    let app_ref = unsafe { ax_helpers::AXUIElementCreateApplication(win.pid) };
    if app_ref.is_null() {
        return CallToolResult::error("Failed to create AX application element");
    }

    let result = match find_ax_window(app_ref, &win) {
        Some(ax_win) => {
            let res = ax_helpers::set_ax_bool(ax_win, ax_helpers::AX_MINIMIZED, true);
            unsafe { CFRelease(ax_win as CFTypeRef) };
            res
        }
        None => {
            unsafe { CFRelease(app_ref as CFTypeRef) };
            return CallToolResult::error(format!(
                "Could not find AX window element for window {window_id}"
            ));
        }
    };

    unsafe { CFRelease(app_ref as CFTypeRef) };

    match result {
        Ok(()) => CallToolResult::text(format!("Minimized window {}", window_id)),
        Err(code) => CallToolResult::error(format!(
            "Failed to minimize window {}: AX error {}",
            window_id, code
        )),
    }
}

/// Close a window by window ID.
pub fn close_window(window_id: u32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let win = match cg_helpers::get_window(window_id) {
        Some(w) => w,
        None => return CallToolResult::error(format!("Window {window_id} not found")),
    };

    let app_ref = unsafe { ax_helpers::AXUIElementCreateApplication(win.pid) };
    if app_ref.is_null() {
        return CallToolResult::error("Failed to create AX application element");
    }

    let result = match find_ax_window(app_ref, &win) {
        Some(ax_win) => {
            let res = match ax_helpers::get_ax_raw(ax_win, ax_helpers::AX_CLOSE_BUTTON) {
                Some(close_btn) => {
                    let action_res =
                        ax_helpers::perform_ax_action(close_btn as AXUIElementRef, ax_helpers::AX_PRESS_ACTION);
                    unsafe { CFRelease(close_btn) };
                    action_res
                }
                None => Err(-1),
            };
            unsafe { CFRelease(ax_win as CFTypeRef) };
            res
        }
        None => {
            unsafe { CFRelease(app_ref as CFTypeRef) };
            return CallToolResult::error(format!(
                "Could not find AX window element for window {window_id}"
            ));
        }
    };

    unsafe { CFRelease(app_ref as CFTypeRef) };

    match result {
        Ok(()) => CallToolResult::text(format!("Closed window {}", window_id)),
        Err(code) => CallToolResult::error(format!(
            "Failed to close window {}: AX error {} (close button may not exist)",
            window_id, code
        )),
    }
}

// ── Internal: Find the AX window element matching a CG window ──────────────

/// Match a CG WindowInfo to an AXUIElement window by comparing position and size.
/// The caller must CFRelease the returned AXUIElementRef.
fn find_ax_window(app_ref: AXUIElementRef, target: &cg_helpers::WindowInfo) -> Option<AXUIElementRef> {
    let windows_ref = ax_helpers::get_ax_raw(app_ref, ax_helpers::AX_WINDOWS)?;

    let count = unsafe { core_foundation::array::CFArrayGetCount(windows_ref as *const _) };

    let mut best_match: Option<AXUIElementRef> = None;
    let mut best_distance = f64::MAX;

    for i in 0..count {
        let ax_win =
            unsafe { core_foundation::array::CFArrayGetValueAtIndex(windows_ref as *const _, i) };
        if ax_win.is_null() {
            continue;
        }
        let ax_win = ax_win as AXUIElementRef;

        // Compare position
        if let Some((ax_x, ax_y)) = ax_helpers::get_ax_position(ax_win) {
            if let Some((ax_w, ax_h)) = ax_helpers::get_ax_size(ax_win) {
                let dx = ax_x - target.x;
                let dy = ax_y - target.y;
                let dw = ax_w - target.width;
                let dh = ax_h - target.height;
                let distance = dx * dx + dy * dy + dw * dw + dh * dh;

                if distance < best_distance {
                    best_distance = distance;
                    best_match = Some(ax_win);
                }
            }
        }
    }

    // Retain the best match before releasing the array
    if let Some(win) = best_match {
        unsafe { core_foundation::base::CFRetain(win as CFTypeRef) };
    }

    unsafe { CFRelease(windows_ref) };
    best_match
}
