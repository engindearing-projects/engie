use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use std::ffi::c_void;
use std::ptr;

// ── AX FFI Types ────────────────────────────────────────────────────────────

pub type AXUIElementRef = *const c_void;
pub type AXValueRef = *const c_void;
pub type AXError = i32;

pub const AX_ERROR_SUCCESS: AXError = 0;

// AXValueType constants
pub const K_AX_VALUE_TYPE_CGPOINT: u32 = 1;
pub const K_AX_VALUE_TYPE_CGSIZE: u32 = 2;

// ── AX FFI Functions ────────────────────────────────────────────────────────

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    pub fn AXIsProcessTrusted() -> bool;
    pub fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    pub fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    pub fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    pub fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFTypeRef,
        value: CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementPerformAction(element: AXUIElementRef, action: CFTypeRef) -> AXError;
    pub fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXUIElementCopyActionNames(
        element: AXUIElementRef,
        names: *mut CFTypeRef,
    ) -> AXError;
    pub fn AXValueCreate(value_type: u32, value: *const c_void) -> AXValueRef;
    pub fn AXValueGetValue(
        value: AXValueRef,
        value_type: u32,
        value_ptr: *mut c_void,
    ) -> bool;
}

// ── Common AX Attribute Keys ────────────────────────────────────────────────

pub fn ax_attr(name: &str) -> CFString {
    CFString::new(name)
}

// Standard attribute names
pub const AX_ROLE: &str = "AXRole";
pub const AX_TITLE: &str = "AXTitle";
pub const AX_DESCRIPTION: &str = "AXDescription";
pub const AX_VALUE: &str = "AXValue";
pub const AX_POSITION: &str = "AXPosition";
pub const AX_SIZE: &str = "AXSize";
pub const AX_ENABLED: &str = "AXEnabled";
pub const AX_FOCUSED: &str = "AXFocused";
pub const AX_CHILDREN: &str = "AXChildren";
pub const AX_WINDOWS: &str = "AXWindows";
pub const AX_MAIN_WINDOW: &str = "AXMainWindow";
pub const AX_FOCUSED_WINDOW: &str = "AXFocusedWindow";
pub const AX_MINIMIZED: &str = "AXMinimized";
pub const AX_CLOSE_BUTTON: &str = "AXCloseButton";
pub const AX_SUBROLE: &str = "AXSubrole";
pub const AX_FOCUSED_APPLICATION: &str = "AXFocusedApplication";
pub const AX_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";

// Action names
pub const AX_PRESS_ACTION: &str = "AXPress";
pub const AX_RAISE_ACTION: &str = "AXRaise";

// ── Helper Functions ────────────────────────────────────────────────────────

/// Check if the process has accessibility permissions.
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Check if trusted, prompting the user if not.
pub fn ensure_trusted() -> Result<(), String> {
    if is_trusted() {
        return Ok(());
    }

    // Prompt with the system dialog
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val = CFBoolean::true_value();
    let pairs = [(key, val)];

    let options = CFDictionary::from_CFType_pairs(&pairs);

    let trusted = unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) };

    if trusted {
        Ok(())
    } else {
        Err("Accessibility permission required. Please grant access in System Settings > Privacy & Security > Accessibility.".into())
    }
}

/// Get a string attribute from an AX element.
pub fn get_ax_string(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let attr = ax_attr(attribute);
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    let cf_str: CFString = unsafe { CFString::wrap_under_create_rule(value as *const _) };
    Some(cf_str.to_string())
}

/// Get a boolean attribute from an AX element.
pub fn get_ax_bool(element: AXUIElementRef, attribute: &str) -> Option<bool> {
    let attr = ax_attr(attribute);
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    let cf_bool: CFBoolean = unsafe { CFBoolean::wrap_under_create_rule(value as *const _) };
    Some(cf_bool.into())
}

/// Get the position (x, y) of an AX element.
pub fn get_ax_position(element: AXUIElementRef) -> Option<(f64, f64)> {
    let attr = ax_attr(AX_POSITION);
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    let mut point = core_graphics::geometry::CGPoint::new(0.0, 0.0);
    let ok = unsafe {
        AXValueGetValue(
            value,
            K_AX_VALUE_TYPE_CGPOINT,
            &mut point as *mut _ as *mut c_void,
        )
    };
    unsafe { CFRelease(value) };
    if ok {
        Some((point.x, point.y))
    } else {
        None
    }
}

/// Get the size (width, height) of an AX element.
pub fn get_ax_size(element: AXUIElementRef) -> Option<(f64, f64)> {
    let attr = ax_attr(AX_SIZE);
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
    if err != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }
    let mut size = core_graphics::geometry::CGSize::new(0.0, 0.0);
    let ok = unsafe {
        AXValueGetValue(
            value,
            K_AX_VALUE_TYPE_CGSIZE,
            &mut size as *mut _ as *mut c_void,
        )
    };
    unsafe { CFRelease(value) };
    if ok {
        Some((size.width, size.height))
    } else {
        None
    }
}

/// Set the position of an AX element.
pub fn set_ax_position(element: AXUIElementRef, x: f64, y: f64) -> Result<(), AXError> {
    let point = core_graphics::geometry::CGPoint::new(x, y);
    let value = unsafe { AXValueCreate(K_AX_VALUE_TYPE_CGPOINT, &point as *const _ as *const c_void) };
    if value.is_null() {
        return Err(-1);
    }
    let attr = ax_attr(AX_POSITION);
    let err = unsafe { AXUIElementSetAttributeValue(element, attr.as_CFTypeRef(), value as CFTypeRef) };
    unsafe { CFRelease(value as CFTypeRef) };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(err)
    }
}

/// Set the size of an AX element.
pub fn set_ax_size(element: AXUIElementRef, width: f64, height: f64) -> Result<(), AXError> {
    let size = core_graphics::geometry::CGSize::new(width, height);
    let value = unsafe { AXValueCreate(K_AX_VALUE_TYPE_CGSIZE, &size as *const _ as *const c_void) };
    if value.is_null() {
        return Err(-1);
    }
    let attr = ax_attr(AX_SIZE);
    let err = unsafe { AXUIElementSetAttributeValue(element, attr.as_CFTypeRef(), value as CFTypeRef) };
    unsafe { CFRelease(value as CFTypeRef) };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(err)
    }
}

/// Perform an action on an AX element.
pub fn perform_ax_action(element: AXUIElementRef, action: &str) -> Result<(), AXError> {
    let act = ax_attr(action);
    let err = unsafe { AXUIElementPerformAction(element, act.as_CFTypeRef()) };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(err)
    }
}

/// Get a raw attribute value (caller must CFRelease).
pub fn get_ax_raw(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
    let attr = ax_attr(attribute);
    let mut value: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(element, attr.as_CFTypeRef(), &mut value) };
    if err == AX_ERROR_SUCCESS && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

/// Set a boolean attribute on an AX element.
pub fn set_ax_bool(element: AXUIElementRef, attribute: &str, val: bool) -> Result<(), AXError> {
    let attr = ax_attr(attribute);
    let cf_val = if val {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let err = unsafe {
        AXUIElementSetAttributeValue(element, attr.as_CFTypeRef(), cf_val.as_CFTypeRef())
    };
    if err == AX_ERROR_SUCCESS {
        Ok(())
    } else {
        Err(err)
    }
}
