use image::{ImageBuffer, Rgba};
use tray_icon::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    Icon, TrayIcon, TrayIconBuilder,
};

/// Holds references to menu items that can be updated dynamically.
pub struct MenuItems {
    pub status_item: MenuItem,
    pub last_tool_item: MenuItem,
    pub settings_item: MenuItem,
    pub quit_item: MenuItem,
}

/// Build the tray dropdown menu and return both the menu and item handles.
pub fn build_menu(status_text: &str, last_tool_text: &str) -> (Menu, MenuItems) {
    let menu = Menu::new();

    let status_item = MenuItem::new(status_text, false, None);
    let last_tool_item = MenuItem::new(last_tool_text, false, None);
    let settings_item = MenuItem::new("Settings...", true, None);
    let quit_item = MenuItem::new("Quit", true, None);

    let _ = menu.append_items(&[
        &status_item,
        &PredefinedMenuItem::separator(),
        &last_tool_item,
        &PredefinedMenuItem::separator(),
        &settings_item,
        &quit_item,
    ]);

    let items = MenuItems {
        status_item,
        last_tool_item,
        settings_item,
        quit_item,
    };

    (menu, items)
}

/// Generate an 18x18 icon: a filled circle on transparent background.
/// Black fill — macOS template mode inverts it to match the menu bar theme.
pub fn generate_icon() -> Icon {
    let size = 18u32;
    let center = (size as f32) / 2.0;
    let radius = 7.0f32;

    let img = ImageBuffer::from_fn(size, size, |x, y| {
        let dx = x as f32 - center;
        let dy = y as f32 - center;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist <= radius {
            let alpha = if dist > radius - 1.0 {
                ((radius - dist) * 255.0) as u8
            } else {
                255u8
            };
            // Black fill — template mode handles color
            Rgba([0, 0, 0, alpha])
        } else {
            Rgba([0, 0, 0, 0])
        }
    });

    let (width, height) = img.dimensions();
    let rgba = img.into_raw();
    Icon::from_rgba(rgba, width, height).expect("failed to create tray icon from RGBA data")
}

/// Load an icon from embedded PNG bytes, falling back to a generated icon.
/// Only uses the embedded image if it decodes to at least 8x8 pixels.
pub fn load_icon() -> Icon {
    let png_bytes = include_bytes!("../assets/icon.png");
    if let Ok(img) = image::load_from_memory(png_bytes) {
        let rgba = img.into_rgba8();
        let (w, h) = rgba.dimensions();
        if w >= 8 && h >= 8 {
            let raw = rgba.into_raw();
            if let Ok(icon) = Icon::from_rgba(raw, w, h) {
                return icon;
            }
        }
    }

    // Fall back to generated icon
    generate_icon()
}

/// Build the tray icon with the given menu. On macOS, only the title text is
/// shown (no separate icon image) to avoid a duplicate dot in the menu bar.
pub fn build_tray(menu: Menu, _icon: Icon, title: &str) -> TrayIcon {
    let builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(title)
        .with_title(title)
        .with_menu_on_left_click(true);

    // macOS: skip the icon image — the "● Name" title is sufficient.
    // Other platforms need an icon to be visible in the system tray.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.with_icon(_icon);

    builder.build().expect("failed to build tray icon")
}

/// Update the status line in the menu.
pub fn update_status(item: &MenuItem, text: &str) {
    item.set_text(text);
}

/// Update the last tool line in the menu.
pub fn update_last_tool(item: &MenuItem, text: &str) {
    item.set_text(text);
}

/// Update the tray title text to reflect connection state.
/// Shows "● name" when connected, "○ name" when disconnected.
pub fn update_title(tray: &TrayIcon, name: &str, connected: bool) {
    let prefix = if connected { "\u{25CF}" } else { "\u{25CB}" };
    tray.set_title(Some(format!("{} {}", prefix, name)));
}

/// Update the tooltip shown on hover with status details.
pub fn update_tooltip(tray: &TrayIcon, name: &str, connected: bool, calls: u64, uptime: &str) {
    let status = if connected { "connected" } else { "disconnected" };
    let tip = format!("{} \u{2014} {}\n{} calls \u{00B7} {} uptime", name, status, calls, uptime);
    let _ = tray.set_tooltip(Some(tip));
}
