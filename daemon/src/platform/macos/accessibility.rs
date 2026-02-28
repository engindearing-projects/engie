use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::string::CFString;
use serde_json::{json, Value};

use crate::mcp::types::CallToolResult;
use crate::platform::macos::ax_helpers;
use ax_helpers::AXUIElementRef;

// ── Read Element Tree ──────────────────────────────────────────────────────

/// Read the UI element tree for an application, up to `max_depth` levels deep.
pub fn read_tree(pid: i32, max_depth: usize) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let tree = read_element(app, 0, max_depth);
    unsafe { CFRelease(app as CFTypeRef) };

    CallToolResult::json(&tree)
}

/// Recursively read an AX element into a JSON value.
fn read_element(element: AXUIElementRef, depth: usize, max_depth: usize) -> Value {
    let role = ax_helpers::get_ax_string(element, ax_helpers::AX_ROLE).unwrap_or_default();
    let title = ax_helpers::get_ax_string(element, ax_helpers::AX_TITLE);
    let description = ax_helpers::get_ax_string(element, ax_helpers::AX_DESCRIPTION);
    let value = ax_helpers::get_ax_string(element, ax_helpers::AX_VALUE);
    let position = ax_helpers::get_ax_position(element);
    let size = ax_helpers::get_ax_size(element);
    let enabled = ax_helpers::get_ax_bool(element, ax_helpers::AX_ENABLED);
    let subrole = ax_helpers::get_ax_string(element, ax_helpers::AX_SUBROLE);

    let mut obj = json!({ "role": role });
    if let Some(t) = title {
        if !t.is_empty() {
            obj["title"] = json!(t);
        }
    }
    if let Some(sr) = subrole {
        if !sr.is_empty() {
            obj["subrole"] = json!(sr);
        }
    }
    if let Some(d) = description {
        if !d.is_empty() {
            obj["description"] = json!(d);
        }
    }
    if let Some(v) = value {
        if !v.is_empty() {
            obj["value"] = json!(v);
        }
    }
    if let Some((x, y)) = position {
        obj["position"] = json!({"x": x, "y": y});
    }
    if let Some((w, h)) = size {
        obj["size"] = json!({"width": w, "height": h});
    }
    if let Some(e) = enabled {
        obj["enabled"] = json!(e);
    }

    if depth < max_depth {
        if let Some(children_ref) = ax_helpers::get_ax_raw(element, ax_helpers::AX_CHILDREN) {
            let count =
                unsafe { core_foundation::array::CFArrayGetCount(children_ref as *const _) };
            let mut child_elements = Vec::new();
            for i in 0..count {
                let child = unsafe {
                    core_foundation::array::CFArrayGetValueAtIndex(children_ref as *const _, i)
                };
                if !child.is_null() {
                    child_elements.push(read_element(
                        child as AXUIElementRef,
                        depth + 1,
                        max_depth,
                    ));
                }
            }
            if !child_elements.is_empty() {
                obj["children"] = json!(child_elements);
            }
            unsafe { CFRelease(children_ref) };
        }
    }

    obj
}

// ── Focused Element ────────────────────────────────────────────────────────

/// Get the currently focused UI element from the system-wide accessibility object.
pub fn focused_element() -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let system = unsafe { ax_helpers::AXUIElementCreateSystemWide() };
    if system.is_null() {
        return CallToolResult::error("Failed to create system-wide AX element");
    }

    let focused_ref =
        ax_helpers::get_ax_raw(system, ax_helpers::AX_FOCUSED_UI_ELEMENT);
    unsafe { CFRelease(system as CFTypeRef) };

    let focused = match focused_ref {
        Some(f) => f,
        None => return CallToolResult::error("No focused UI element found"),
    };

    let element = focused as AXUIElementRef;
    let role = ax_helpers::get_ax_string(element, ax_helpers::AX_ROLE).unwrap_or_default();
    let title = ax_helpers::get_ax_string(element, ax_helpers::AX_TITLE);
    let value = ax_helpers::get_ax_string(element, ax_helpers::AX_VALUE);
    let description = ax_helpers::get_ax_string(element, ax_helpers::AX_DESCRIPTION);
    let position = ax_helpers::get_ax_position(element);
    let size = ax_helpers::get_ax_size(element);
    let enabled = ax_helpers::get_ax_bool(element, ax_helpers::AX_ENABLED);
    let subrole = ax_helpers::get_ax_string(element, ax_helpers::AX_SUBROLE);

    let mut info = json!({ "role": role });
    if let Some(t) = title {
        info["title"] = json!(t);
    }
    if let Some(sr) = subrole {
        info["subrole"] = json!(sr);
    }
    if let Some(d) = description {
        info["description"] = json!(d);
    }
    if let Some(v) = value {
        info["value"] = json!(v);
    }
    if let Some((x, y)) = position {
        info["position"] = json!({"x": x, "y": y});
    }
    if let Some((w, h)) = size {
        info["size"] = json!({"width": w, "height": h});
    }
    if let Some(e) = enabled {
        info["enabled"] = json!(e);
    }

    unsafe { CFRelease(focused) };

    CallToolResult::json(&info)
}

// ── Click Element ──────────────────────────────────────────────────────────

/// Find an element by role (and optional title) and perform the AXPress action.
pub fn click_element(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Element not found: {desc}"));
    }

    let result = match ax_helpers::perform_ax_action(found, ax_helpers::AX_PRESS_ACTION) {
        Ok(()) => {
            let desc = match title {
                Some(t) => format!("Clicked element: role='{role}', title='{t}'"),
                None => format!("Clicked element: role='{role}'"),
            };
            CallToolResult::text(desc)
        }
        Err(code) => CallToolResult::error(format!("AXPress failed with error code {code}")),
    };

    // Do not CFRelease `found` -- it is a borrowed reference from the tree walk
    unsafe { CFRelease(app as CFTypeRef) };
    result
}

// ── Set Value ──────────────────────────────────────────────────────────────

/// Find an element by role (and optional title) and set its AXValue attribute.
pub fn set_value(pid: i32, role: &str, title: Option<&str>, value: &str) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Element not found: {desc}"));
    }

    let cf_value = CFString::new(value);
    let attr = ax_helpers::ax_attr(ax_helpers::AX_VALUE);
    let err = unsafe {
        ax_helpers::AXUIElementSetAttributeValue(
            found,
            attr.as_CFTypeRef(),
            cf_value.as_CFTypeRef(),
        )
    };

    unsafe { CFRelease(app as CFTypeRef) };

    if err == ax_helpers::AX_ERROR_SUCCESS {
        let desc = match title {
            Some(t) => format!("Set value on element: role='{role}', title='{t}'"),
            None => format!("Set value on element: role='{role}'"),
        };
        CallToolResult::text(desc)
    } else {
        CallToolResult::error(format!("AXUIElementSetAttributeValue failed with error code {err}"))
    }
}

// ── Element Info ───────────────────────────────────────────────────────────

/// Find an element by role (and optional title) and return all its attribute names and values.
pub fn element_info(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Element not found: {desc}"));
    }

    // Get attribute names
    let mut names_ref: CFTypeRef = std::ptr::null();
    let err = unsafe { ax_helpers::AXUIElementCopyAttributeNames(found, &mut names_ref) };

    if err != ax_helpers::AX_ERROR_SUCCESS || names_ref.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        return CallToolResult::error(format!(
            "Failed to get attribute names (error code {err})"
        ));
    }

    let count = unsafe { core_foundation::array::CFArrayGetCount(names_ref as *const _) };
    let mut info = serde_json::Map::new();

    for i in 0..count {
        let name_ref = unsafe {
            core_foundation::array::CFArrayGetValueAtIndex(names_ref as *const _, i)
        };
        if name_ref.is_null() {
            continue;
        }
        let name_cf: CFString =
            unsafe { CFString::wrap_under_get_rule(name_ref as *const _) };
        let name = name_cf.to_string();

        // Try to get the value as a string
        if let Some(val) = ax_helpers::get_ax_string(found, &name) {
            info.insert(name, json!(val));
        } else if let Some(val) = ax_helpers::get_ax_bool(found, &name) {
            info.insert(name, json!(val));
        } else if name == ax_helpers::AX_POSITION {
            if let Some((x, y)) = ax_helpers::get_ax_position(found) {
                info.insert(name, json!({"x": x, "y": y}));
            }
        } else if name == ax_helpers::AX_SIZE {
            if let Some((w, h)) = ax_helpers::get_ax_size(found) {
                info.insert(name, json!({"width": w, "height": h}));
            }
        } else {
            // Skip complex attributes we can't easily serialize
            info.insert(name, json!("<complex>"));
        }
    }

    unsafe { CFRelease(names_ref) };
    unsafe { CFRelease(app as CFTypeRef) };

    CallToolResult::json(&Value::Object(info))
}

// ── Find Elements (flexible search) ───────────────────────────────────────

/// Search the accessibility tree by role, title pattern, and/or value pattern.
/// Returns up to `max_results` matching elements.
pub fn find_elements(
    pid: i32,
    role: Option<&str>,
    title_pattern: Option<&str>,
    value_pattern: Option<&str>,
    max_results: usize,
    max_depth: usize,
) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    if role.is_none() && title_pattern.is_none() && value_pattern.is_none() {
        return CallToolResult::error("At least one of role, title_pattern, or value_pattern must be provided");
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    // Cap depth at 3 to avoid ObjC exceptions from deep/unexpanded elements
    let safe_depth = max_depth.min(3);
    let mut results = Vec::new();
    find_matching_elements(app, role, title_pattern, value_pattern, 0, safe_depth, max_results, &mut results);
    unsafe { CFRelease(app as CFTypeRef) };

    if results.is_empty() {
        let mut desc_parts = Vec::new();
        if let Some(r) = role { desc_parts.push(format!("role='{r}'")); }
        if let Some(tp) = title_pattern { desc_parts.push(format!("title~'{tp}'")); }
        if let Some(vp) = value_pattern { desc_parts.push(format!("value~'{vp}'")); }
        return CallToolResult::error(format!("No elements found matching: {}", desc_parts.join(", ")));
    }

    CallToolResult::json(&json!(results))
}

fn find_matching_elements(
    element: AXUIElementRef,
    target_role: Option<&str>,
    title_pattern: Option<&str>,
    value_pattern: Option<&str>,
    depth: usize,
    max_depth: usize,
    max_results: usize,
    results: &mut Vec<Value>,
) {
    if results.len() >= max_results || element.is_null() {
        return;
    }

    // Safely try to read role — use raw AX call and check error code before converting
    // This avoids ObjC exceptions that can crash the process
    let role_attr = ax_helpers::ax_attr(ax_helpers::AX_ROLE);
    let mut role_ref: core_foundation::base::CFTypeRef = std::ptr::null();
    let role_err = unsafe {
        ax_helpers::AXUIElementCopyAttributeValue(element, role_attr.as_CFTypeRef(), &mut role_ref)
    };
    if role_err != ax_helpers::AX_ERROR_SUCCESS || role_ref.is_null() {
        return; // Can't read role — element is invalid or inaccessible
    }
    let role_cf: core_foundation::string::CFString = unsafe {
        core_foundation::string::CFString::wrap_under_create_rule(role_ref as *const _)
    };
    let role = role_cf.to_string();

    let title = ax_helpers::get_ax_string(element, ax_helpers::AX_TITLE).unwrap_or_default();
    let value = ax_helpers::get_ax_string(element, ax_helpers::AX_VALUE).unwrap_or_default();

    // Check if this element matches
    let role_match = target_role.map_or(true, |r| role == r);
    let title_match = title_pattern.map_or(true, |p| title.to_lowercase().contains(&p.to_lowercase()));
    let value_match = value_pattern.map_or(true, |p| value.to_lowercase().contains(&p.to_lowercase()));

    if role_match && title_match && value_match {
        let position = ax_helpers::get_ax_position(element);
        let size = ax_helpers::get_ax_size(element);
        let enabled = ax_helpers::get_ax_bool(element, ax_helpers::AX_ENABLED);

        let mut obj = json!({ "role": role });
        if !title.is_empty() { obj["title"] = json!(title); }
        if !value.is_empty() { obj["value"] = json!(value); }
        if let Some((x, y)) = position { obj["position"] = json!({"x": x, "y": y}); }
        if let Some((w, h)) = size { obj["size"] = json!({"width": w, "height": h}); }
        if let Some(e) = enabled { obj["enabled"] = json!(e); }
        obj["depth"] = json!(depth);

        results.push(obj);
    }

    if depth >= max_depth || results.len() >= max_results {
        return;
    }

    // Skip recursing into menu items — they throw ObjC exceptions when not expanded
    if role == "AXMenuBarItem" || role == "AXMenuItem" {
        return;
    }

    // Recurse into children — hold the CFArray until all children are processed
    let children_ref = ax_helpers::get_ax_raw(element, ax_helpers::AX_CHILDREN);
    if let Some(cref) = children_ref {
        let count = unsafe { core_foundation::array::CFArrayGetCount(cref as *const _) };
        for i in 0..count {
            if results.len() >= max_results {
                break;
            }
            let child = unsafe { core_foundation::array::CFArrayGetValueAtIndex(cref as *const _, i) };
            if !child.is_null() {
                find_matching_elements(
                    child as AXUIElementRef,
                    target_role,
                    title_pattern,
                    value_pattern,
                    depth + 1,
                    max_depth,
                    max_results,
                    results,
                );
            }
        }
        unsafe { CFRelease(cref) };
    }
}

// ── Get Actions ────────────────────────────────────────────────────────────

/// List available actions on an element found by role and optional title.
pub fn get_actions(pid: i32, role: &str, title: Option<&str>) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Element not found: {desc}"));
    }

    // Get action names — use safe error-code check
    let mut names_ref: CFTypeRef = std::ptr::null();
    let err = unsafe { ax_helpers::AXUIElementCopyActionNames(found, &mut names_ref) };

    if err != ax_helpers::AX_ERROR_SUCCESS || names_ref.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        return CallToolResult::error(format!("Failed to get action names (error code {err})"));
    }

    let count = unsafe { core_foundation::array::CFArrayGetCount(names_ref as *const _) };
    let mut actions = Vec::new();
    for i in 0..count {
        let name_ref = unsafe { core_foundation::array::CFArrayGetValueAtIndex(names_ref as *const _, i) };
        if !name_ref.is_null() {
            let name_cf: CFString = unsafe { CFString::wrap_under_get_rule(name_ref as *const _) };
            actions.push(name_cf.to_string());
        }
    }

    unsafe { CFRelease(names_ref) };
    unsafe { CFRelease(app as CFTypeRef) };

    CallToolResult::json(&json!({
        "element": {
            "role": role,
            "title": title.unwrap_or(""),
        },
        "actions": actions,
    }))
}

// ── Perform Action ─────────────────────────────────────────────────────────

/// Perform a named action on an element found by role and optional title.
pub fn perform_action(pid: i32, role: &str, title: Option<&str>, action: &str) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Element not found: {desc}"));
    }

    let result = match ax_helpers::perform_ax_action(found, action) {
        Ok(()) => {
            let desc = match title {
                Some(t) => format!("Performed '{action}' on element: role='{role}', title='{t}'"),
                None => format!("Performed '{action}' on element: role='{role}'"),
            };
            CallToolResult::text(desc)
        }
        Err(code) => CallToolResult::error(format!("{action} failed with error code {code}")),
    };

    unsafe { CFRelease(app as CFTypeRef) };
    result
}

// ── Scroll Element ─────────────────────────────────────────────────────────

/// Scroll within a scroll area element.
pub fn scroll_element(pid: i32, role: &str, title: Option<&str>, direction: &str, amount: i32) -> CallToolResult {
    if let Err(e) = ax_helpers::ensure_trusted() {
        return CallToolResult::error(e);
    }

    let app = unsafe { ax_helpers::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return CallToolResult::error(format!("Failed to create AX element for pid {pid}"));
    }

    let found = find_element(app, role, title, 3);
    if found.is_null() {
        unsafe { CFRelease(app as CFTypeRef) };
        let desc = match title {
            Some(t) => format!("role='{role}', title='{t}'"),
            None => format!("role='{role}'"),
        };
        return CallToolResult::error(format!("Scroll area not found: {desc}"));
    }

    // Get the element's position to scroll at its center
    let position = ax_helpers::get_ax_position(found);
    let size = ax_helpers::get_ax_size(found);

    unsafe { CFRelease(app as CFTypeRef) };

    match (position, size) {
        (Some((x, y)), Some((w, h))) => {
            let center_x = x + w / 2.0;
            let center_y = y + h / 2.0;

            let (dy, dx) = match direction {
                "up" => (amount, 0),
                "down" => (-amount, 0),
                "left" => (0, amount),
                "right" => (0, -amount),
                _ => return CallToolResult::error(format!("Unknown direction: '{direction}'. Use up, down, left, right.")),
            };

            // Use CGEvent scroll at the element's center
            crate::platform::macos::input_sim::scroll(center_x, center_y, dy, dx)
        }
        _ => CallToolResult::error("Could not determine element position/size for scrolling"),
    }
}

// ── Element Search Helper ──────────────────────────────────────────────────

/// Walk the AX tree to find an element matching the given role and optional title.
/// Returns a raw AXUIElementRef (borrowed from the tree, caller should NOT CFRelease it
/// independently of the app element). Returns null if not found.
fn find_element(
    root: AXUIElementRef,
    target_role: &str,
    target_title: Option<&str>,
    max_depth: usize,
) -> AXUIElementRef {
    find_element_recursive(root, target_role, target_title, 0, max_depth)
}

fn find_element_recursive(
    element: AXUIElementRef,
    target_role: &str,
    target_title: Option<&str>,
    depth: usize,
    max_depth: usize,
) -> AXUIElementRef {
    if element.is_null() {
        return std::ptr::null();
    }

    // Check if this element matches
    let role = match ax_helpers::get_ax_string(element, ax_helpers::AX_ROLE) {
        Some(r) => r,
        None => return std::ptr::null(),
    };
    if role == target_role {
        match target_title {
            Some(tt) => {
                let title =
                    ax_helpers::get_ax_string(element, ax_helpers::AX_TITLE).unwrap_or_default();
                if title == tt {
                    return element;
                }
            }
            None => return element,
        }
    }

    if depth >= max_depth {
        return std::ptr::null();
    }

    // Skip menu items to avoid ObjC exceptions from unexpanded menus
    if role == "AXMenuBarItem" || role == "AXMenuItem" {
        return std::ptr::null();
    }

    // Recurse into children
    if let Some(children_ref) = ax_helpers::get_ax_raw(element, ax_helpers::AX_CHILDREN) {
        let count =
            unsafe { core_foundation::array::CFArrayGetCount(children_ref as *const _) };
        for i in 0..count {
            let child = unsafe {
                core_foundation::array::CFArrayGetValueAtIndex(children_ref as *const _, i)
            };
            if !child.is_null() {
                let found = find_element_recursive(
                    child as AXUIElementRef,
                    target_role,
                    target_title,
                    depth + 1,
                    max_depth,
                );
                if !found.is_null() {
                    unsafe { CFRelease(children_ref) };
                    return found;
                }
            }
        }
        unsafe { CFRelease(children_ref) };
    }

    std::ptr::null()
}
