use std::process::Command;
use std::thread;
use std::time::Duration;

use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGKeyCode, CGMouseButton, EventField,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;

use crate::mcp::types::CallToolResult;
use crate::platform::macos::ax_helpers;

// ── Keycode Lookup ─────────────────────────────────────────────────────────

/// Map a human-readable key name to a macOS virtual keycode.
pub fn keycode_for_name(name: &str) -> Option<CGKeyCode> {
    let lower = name.to_lowercase();
    match lower.as_str() {
        // Letters
        "a" => Some(0x00),
        "b" => Some(0x0B),
        "c" => Some(0x08),
        "d" => Some(0x02),
        "e" => Some(0x0E),
        "f" => Some(0x03),
        "g" => Some(0x05),
        "h" => Some(0x04),
        "i" => Some(0x22),
        "j" => Some(0x26),
        "k" => Some(0x28),
        "l" => Some(0x25),
        "m" => Some(0x2E),
        "n" => Some(0x2D),
        "o" => Some(0x1F),
        "p" => Some(0x23),
        "q" => Some(0x0C),
        "r" => Some(0x0F),
        "s" => Some(0x01),
        "t" => Some(0x11),
        "u" => Some(0x20),
        "v" => Some(0x09),
        "w" => Some(0x0D),
        "x" => Some(0x07),
        "y" => Some(0x10),
        "z" => Some(0x06),
        // Numbers
        "0" => Some(0x1D),
        "1" => Some(0x12),
        "2" => Some(0x13),
        "3" => Some(0x14),
        "4" => Some(0x15),
        "5" => Some(0x17),
        "6" => Some(0x16),
        "7" => Some(0x1A),
        "8" => Some(0x1C),
        "9" => Some(0x19),
        // Special keys
        "return" | "enter" => Some(0x24),
        "tab" => Some(0x30),
        "space" => Some(0x31),
        "delete" | "backspace" => Some(0x33),
        "escape" | "esc" => Some(0x35),
        "forward_delete" | "forwarddelete" => Some(0x75),
        "home" => Some(0x73),
        "end" => Some(0x77),
        "pageup" | "page_up" => Some(0x74),
        "pagedown" | "page_down" => Some(0x79),
        // Arrow keys
        "left" => Some(0x7B),
        "right" => Some(0x7C),
        "down" => Some(0x7D),
        "up" => Some(0x7E),
        // Function keys
        "f1" => Some(0x7A),
        "f2" => Some(0x78),
        "f3" => Some(0x63),
        "f4" => Some(0x76),
        "f5" => Some(0x60),
        "f6" => Some(0x61),
        "f7" => Some(0x62),
        "f8" => Some(0x64),
        "f9" => Some(0x65),
        "f10" => Some(0x6D),
        "f11" => Some(0x67),
        "f12" => Some(0x6F),
        // Punctuation
        "apostrophe" | "quote" | "'" => Some(0x27),
        "backslash" | "\\" => Some(0x2A),
        "comma" | "," => Some(0x2B),
        "equals" | "equal" | "=" => Some(0x18),
        "grave" | "backtick" | "`" => Some(0x32),
        "left_bracket" | "leftbracket" | "[" => Some(0x21),
        "minus" | "-" => Some(0x1B),
        "period" | "." => Some(0x2F),
        "right_bracket" | "rightbracket" | "]" => Some(0x1E),
        "semicolon" | ";" => Some(0x29),
        "slash" | "/" => Some(0x2C),
        _ => None,
    }
}

/// Parse modifier names to CGEventFlags.
fn modifier_flags(modifiers: &[String]) -> CGEventFlags {
    let mut flags = CGEventFlags::CGEventFlagNull;
    for m in modifiers {
        match m.to_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" => flags |= CGEventFlags::CGEventFlagCommand,
            "shift" => flags |= CGEventFlags::CGEventFlagShift,
            "alt" | "option" | "opt" => flags |= CGEventFlags::CGEventFlagAlternate,
            "ctrl" | "control" => flags |= CGEventFlags::CGEventFlagControl,
            "fn" | "function" => flags |= CGEventFlags::CGEventFlagSecondaryFn,
            _ => {}
        }
    }
    flags
}

// ── Key Press ──────────────────────────────────────────────────────────────

/// Simulate a key press with optional modifiers.
pub fn key_press(key: &str, modifiers: &[String]) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let keycode = match keycode_for_name(key) {
        Some(kc) => kc,
        None => return CallToolResult::error(format!("Unknown key name: '{key}'")),
    };

    let flags = modifier_flags(modifiers);

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
    };

    // Key down
    let down = match CGEvent::new_keyboard_event(source.clone(), keycode, true) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create key-down event"),
    };
    if flags != CGEventFlags::CGEventFlagNull {
        down.set_flags(flags);
    }
    down.post(CGEventTapLocation::HID);

    // Key up
    let up = match CGEvent::new_keyboard_event(source, keycode, false) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create key-up event"),
    };
    if flags != CGEventFlags::CGEventFlagNull {
        up.set_flags(flags);
    }
    up.post(CGEventTapLocation::HID);

    let mod_str = if modifiers.is_empty() {
        String::new()
    } else {
        format!(" with modifiers [{}]", modifiers.join(", "))
    };
    CallToolResult::text(format!("Pressed key '{key}'{mod_str}"))
}

// ── Type Text ──────────────────────────────────────────────────────────────

/// Type a string of text using osascript for Unicode support.
pub fn type_text(text: &str, delay_ms: u64) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    if text.is_empty() {
        return CallToolResult::text("No text to type");
    }

    // For longer text or when delay is requested, chunk by line to allow delays
    if delay_ms > 0 {
        for ch in text.chars() {
            let sanitized = sanitize_for_applescript(&ch.to_string());
            let script = format!(
                "tell application \"System Events\" to keystroke \"{}\"",
                sanitized
            );
            match Command::new("osascript").args(["-e", &script]).output() {
                Ok(output) if output.status.success() => {}
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return CallToolResult::error(format!("osascript failed: {stderr}"));
                }
                Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
            }
            if delay_ms > 0 {
                thread::sleep(Duration::from_millis(delay_ms));
            }
        }
    } else {
        let sanitized = sanitize_for_applescript(text);
        let script = format!(
            "tell application \"System Events\" to keystroke \"{}\"",
            sanitized
        );
        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return CallToolResult::error(format!("osascript failed: {stderr}"));
            }
            Err(e) => return CallToolResult::error(format!("Failed to run osascript: {e}")),
        }
    }

    CallToolResult::text(format!("Typed {} characters", text.len()))
}

/// Escape text for embedding in an AppleScript string literal.
fn sanitize_for_applescript(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

// ── Mouse Move ─────────────────────────────────────────────────────────────

/// Move the mouse cursor to (x, y).
pub fn mouse_move(x: f64, y: f64) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
    };

    let point = CGPoint::new(x, y);
    let event = match CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create mouse-move event"),
    };
    event.post(CGEventTapLocation::HID);

    CallToolResult::text(format!("Moved mouse to ({x}, {y})"))
}

// ── Mouse Click ────────────────────────────────────────────────────────────

/// Click at (x, y) with the given button, N times.
pub fn mouse_click(x: f64, y: f64, button: &str, clicks: u32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let (down_type, up_type, cg_button) = match button.to_lowercase().as_str() {
        "left" => (CGEventType::LeftMouseDown, CGEventType::LeftMouseUp, CGMouseButton::Left),
        "right" => (CGEventType::RightMouseDown, CGEventType::RightMouseUp, CGMouseButton::Right),
        "center" | "middle" => (CGEventType::OtherMouseDown, CGEventType::OtherMouseUp, CGMouseButton::Center),
        other => return CallToolResult::error(format!("Unknown mouse button: '{other}'. Use left, right, or center.")),
    };

    let point = CGPoint::new(x, y);

    for click_num in 1..=clicks {
        let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
            Ok(s) => s,
            Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
        };

        // Mouse down
        let down = match CGEvent::new_mouse_event(source.clone(), down_type, point, cg_button) {
            Ok(e) => e,
            Err(_) => return CallToolResult::error("Failed to create mouse-down event"),
        };
        // Set click count for multi-click detection (double-click, triple-click)
        down.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click_num as i64);
        down.post(CGEventTapLocation::HID);

        // Mouse up
        let up = match CGEvent::new_mouse_event(source, up_type, point, cg_button) {
            Ok(e) => e,
            Err(_) => return CallToolResult::error("Failed to create mouse-up event"),
        };
        up.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click_num as i64);
        up.post(CGEventTapLocation::HID);
    }

    let click_word = if clicks == 1 { "click" } else { "clicks" };
    CallToolResult::text(format!("{button} {clicks} {click_word} at ({x}, {y})"))
}

// ── Scroll ──────────────────────────────────────────────────────────────

/// Scroll at (x, y) by delta_y (vertical) and delta_x (horizontal).
pub fn scroll(x: f64, y: f64, delta_y: i32, delta_x: i32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    // First move the mouse to the scroll position
    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
    };

    let point = CGPoint::new(x, y);
    let move_event = match CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create mouse-move event"),
    };
    move_event.post(CGEventTapLocation::HID);

    // Use CGEventCreateScrollWheelEvent2 via raw FFI (core-graphics crate doesn't wrap it)
    // kCGScrollEventUnitLine = 0, passing null for source is OK
    let scroll_event = unsafe {
        CGEventCreateScrollWheelEvent2(
            std::ptr::null(),
            0, // kCGScrollEventUnitLine
            2, // wheelCount
            delta_y,
            delta_x,
        )
    };

    if scroll_event.is_null() {
        return CallToolResult::error("Failed to create scroll event");
    }

    unsafe {
        CGEventPost(CGEventTapLocation::HID as u32, scroll_event);
        core_foundation::base::CFRelease(scroll_event as core_foundation::base::CFTypeRef);
    };

    CallToolResult::text(format!("Scrolled at ({x}, {y}): dy={delta_y}, dx={delta_x}"))
}

// FFI for scroll wheel events not exposed by core-graphics crate
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateScrollWheelEvent2(
        source: *const std::ffi::c_void,
        units: u32,
        wheel_count: u32,
        wheel1: i32,
        wheel2: i32,
    ) -> *const std::ffi::c_void;
    fn CGEventPost(tap: u32, event: *const std::ffi::c_void);
}

// ── Drag ────────────────────────────────────────────────────────────────

/// Drag from (from_x, from_y) to (to_x, to_y) over duration_ms.
pub fn drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64, button: &str, duration_ms: u64) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let (down_type, drag_type, up_type, cg_button) = match button.to_lowercase().as_str() {
        "left" => (
            CGEventType::LeftMouseDown,
            CGEventType::LeftMouseDragged,
            CGEventType::LeftMouseUp,
            CGMouseButton::Left,
        ),
        "right" => (
            CGEventType::RightMouseDown,
            CGEventType::RightMouseDragged,
            CGEventType::RightMouseUp,
            CGMouseButton::Right,
        ),
        other => return CallToolResult::error(format!("Unknown mouse button for drag: '{other}'")),
    };

    let from_point = CGPoint::new(from_x, from_y);
    let to_point = CGPoint::new(to_x, to_y);

    // Mouse down at start
    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
    };
    let down = match CGEvent::new_mouse_event(source, down_type, from_point, cg_button) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create mouse-down event"),
    };
    down.post(CGEventTapLocation::HID);

    // Interpolate drag in steps
    let steps = 20u64;
    let step_delay = Duration::from_millis(duration_ms / steps.max(1));
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let cx = from_x + (to_x - from_x) * t;
        let cy = from_y + (to_y - from_y) * t;
        let cp = CGPoint::new(cx, cy);

        let src = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let drag_ev = match CGEvent::new_mouse_event(src, drag_type, cp, cg_button) {
            Ok(e) => e,
            Err(_) => continue,
        };
        drag_ev.post(CGEventTapLocation::HID);
        thread::sleep(step_delay);
    }

    // Mouse up at end
    let source2 = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => return CallToolResult::error("Failed to create CGEventSource"),
    };
    let up = match CGEvent::new_mouse_event(source2, up_type, to_point, cg_button) {
        Ok(e) => e,
        Err(_) => return CallToolResult::error("Failed to create mouse-up event"),
    };
    up.post(CGEventTapLocation::HID);

    CallToolResult::text(format!("Dragged from ({from_x}, {from_y}) to ({to_x}, {to_y}) over {duration_ms}ms"))
}

// ── Hotkey ──────────────────────────────────────────────────────────────

/// Press a keyboard shortcut from a combo string like "cmd+shift+s".
pub fn hotkey(combo: &str) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return CallToolResult::error("Empty hotkey combo");
    }

    // Last part is the key, everything else is modifiers
    let key_name = parts.last().unwrap();
    let modifier_names: Vec<String> = parts[..parts.len() - 1].iter().map(|s| s.to_string()).collect();

    // If the "key" is actually a modifier with no final key (e.g. just "cmd"),
    // treat it as a lone key press
    key_press(key_name, &modifier_names)
}
