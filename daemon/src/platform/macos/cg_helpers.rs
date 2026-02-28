use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{
    kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    CGWindowListCopyWindowInfo,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub pid: i32,
    pub owner_name: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub layer: i32,
    pub on_screen: bool,
}

/// List all on-screen windows (excluding desktop elements).
pub fn list_windows() -> Vec<WindowInfo> {
    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;

    let window_list = unsafe { CGWindowListCopyWindowInfo(options, kCGNullWindowID) };
    if window_list.is_null() {
        return vec![];
    }

    let count = unsafe { core_foundation::array::CFArrayGetCount(window_list) };
    let mut windows = Vec::new();

    for i in 0..count {
        let dict_ref = unsafe { core_foundation::array::CFArrayGetValueAtIndex(window_list, i) };
        if dict_ref.is_null() {
            continue;
        }

        // Parse the dictionary using CFDictionaryGetValue directly
        let dict = dict_ref as core_foundation::dictionary::CFDictionaryRef;

        let window_id = get_dict_i64(dict, "kCGWindowNumber").unwrap_or(0) as u32;
        let pid = get_dict_i64(dict, "kCGWindowOwnerPID").unwrap_or(0) as i32;
        let owner_name = get_dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
        let title = get_dict_string(dict, "kCGWindowName").unwrap_or_default();
        let layer = get_dict_i64(dict, "kCGWindowLayer").unwrap_or(0) as i32;
        let on_screen = get_dict_bool(dict, "kCGWindowIsOnscreen").unwrap_or(false);

        let (x, y, width, height) = get_dict_bounds(dict).unwrap_or((0.0, 0.0, 0.0, 0.0));

        // Skip zero-size windows (menubars, etc.)
        if width < 1.0 || height < 1.0 {
            continue;
        }

        windows.push(WindowInfo {
            id: window_id,
            pid,
            owner_name,
            title,
            x,
            y,
            width,
            height,
            layer,
            on_screen,
        });
    }

    unsafe { core_foundation::base::CFRelease(window_list as *const _) };
    windows
}

/// Get a single window by ID.
pub fn get_window(window_id: u32) -> Option<WindowInfo> {
    list_windows().into_iter().find(|w| w.id == window_id)
}

// ── Low-level CFDictionary helpers using raw pointers ────────────────────────

fn get_dict_string(dict: core_foundation::dictionary::CFDictionaryRef, key: &str) -> Option<String> {
    let cf_key = CFString::new(key);
    let mut value: *const core_foundation::base::CFType = std::ptr::null();
    let found = unsafe {
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(
            dict,
            cf_key.as_CFTypeRef(),
            &mut value as *mut *const _ as *mut *const std::ffi::c_void,
        )
    };
    if found == 0 || value.is_null() {
        return None;
    }
    let s: CFString = unsafe { CFString::wrap_under_get_rule(value as core_foundation::string::CFStringRef) };
    Some(s.to_string())
}

fn get_dict_i64(dict: core_foundation::dictionary::CFDictionaryRef, key: &str) -> Option<i64> {
    let cf_key = CFString::new(key);
    let mut value: *const core_foundation::base::CFType = std::ptr::null();
    let found = unsafe {
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(
            dict,
            cf_key.as_CFTypeRef(),
            &mut value as *mut *const _ as *mut *const std::ffi::c_void,
        )
    };
    if found == 0 || value.is_null() {
        return None;
    }
    let n: CFNumber = unsafe { CFNumber::wrap_under_get_rule(value as core_foundation::number::CFNumberRef) };
    n.to_i64()
}

fn get_dict_f64(dict: core_foundation::dictionary::CFDictionaryRef, key: &str) -> Option<f64> {
    let cf_key = CFString::new(key);
    let mut value: *const core_foundation::base::CFType = std::ptr::null();
    let found = unsafe {
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(
            dict,
            cf_key.as_CFTypeRef(),
            &mut value as *mut *const _ as *mut *const std::ffi::c_void,
        )
    };
    if found == 0 || value.is_null() {
        return None;
    }
    let n: CFNumber = unsafe { CFNumber::wrap_under_get_rule(value as core_foundation::number::CFNumberRef) };
    n.to_f64()
}

fn get_dict_bool(dict: core_foundation::dictionary::CFDictionaryRef, key: &str) -> Option<bool> {
    let cf_key = CFString::new(key);
    let mut value: *const core_foundation::base::CFType = std::ptr::null();
    let found = unsafe {
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(
            dict,
            cf_key.as_CFTypeRef(),
            &mut value as *mut *const _ as *mut *const std::ffi::c_void,
        )
    };
    if found == 0 || value.is_null() {
        return None;
    }
    let b: CFBoolean = unsafe { CFBoolean::wrap_under_get_rule(value as core_foundation::boolean::CFBooleanRef) };
    Some(b.into())
}

fn get_dict_bounds(dict: core_foundation::dictionary::CFDictionaryRef) -> Option<(f64, f64, f64, f64)> {
    let cf_key = CFString::new("kCGWindowBounds");
    let mut value: *const core_foundation::base::CFType = std::ptr::null();
    let found = unsafe {
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(
            dict,
            cf_key.as_CFTypeRef(),
            &mut value as *mut *const _ as *mut *const std::ffi::c_void,
        )
    };
    if found == 0 || value.is_null() {
        return None;
    }
    // Bounds is a nested dictionary
    let bounds_dict = value as core_foundation::dictionary::CFDictionaryRef;
    let x = get_dict_f64(bounds_dict, "X")?;
    let y = get_dict_f64(bounds_dict, "Y")?;
    let w = get_dict_f64(bounds_dict, "Width")?;
    let h = get_dict_f64(bounds_dict, "Height")?;
    Some((x, y, w, h))
}
