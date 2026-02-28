pub mod builtin;

use ratatui::style::Color;

/// 9-token semantic color schema.
#[derive(Debug, Clone)]
pub struct ThemeColors {
    pub primary: Color,
    pub primary_dim: Color,
    pub accent: Color,
    pub warning: Color,
    pub error: Color,
    pub text: Color,
    pub text_muted: Color,
    pub text_dim: Color,
    pub surface: Color,
}

/// Parse a hex color string like "#06b6d4" into a ratatui Color.
pub fn hex_to_color(hex: &str) -> Color {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return Color::White;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(255);
    Color::Rgb(r, g, b)
}

impl ThemeColors {
    /// Load a theme by name, falling back to "familiar".
    pub fn by_name(name: &str) -> Self {
        builtin::get_theme(name).unwrap_or_else(|| builtin::familiar())
    }

    /// Resolve theme name from env or default.
    pub fn resolve() -> (String, Self) {
        let name = std::env::var("FAMILIAR_THEME")
            .or_else(|_| std::env::var("ENGIE_THEME"))
            .unwrap_or_else(|_| "familiar".into());
        let theme = Self::by_name(&name);
        (name, theme)
    }
}
