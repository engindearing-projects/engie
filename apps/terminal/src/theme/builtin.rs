use super::{hex_to_color, ThemeColors};

pub fn familiar() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#06b6d4"),
        primary_dim: hex_to_color("#0891b2"),
        accent: hex_to_color("#22c55e"),
        warning: hex_to_color("#eab308"),
        error: hex_to_color("#ef4444"),
        text: hex_to_color("#f9fafb"),
        text_muted: hex_to_color("#6b7280"),
        text_dim: hex_to_color("#374151"),
        surface: hex_to_color("#1f2937"),
    }
}

pub fn catppuccin() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#89b4fa"),
        primary_dim: hex_to_color("#74c7ec"),
        accent: hex_to_color("#a6e3a1"),
        warning: hex_to_color("#f9e2af"),
        error: hex_to_color("#f38ba8"),
        text: hex_to_color("#cdd6f4"),
        text_muted: hex_to_color("#6c7086"),
        text_dim: hex_to_color("#45475a"),
        surface: hex_to_color("#1e1e2e"),
    }
}

pub fn dracula() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#bd93f9"),
        primary_dim: hex_to_color("#6272a4"),
        accent: hex_to_color("#50fa7b"),
        warning: hex_to_color("#f1fa8c"),
        error: hex_to_color("#ff5555"),
        text: hex_to_color("#f8f8f2"),
        text_muted: hex_to_color("#6272a4"),
        text_dim: hex_to_color("#44475a"),
        surface: hex_to_color("#282a36"),
    }
}

pub fn nord() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#88c0d0"),
        primary_dim: hex_to_color("#81a1c1"),
        accent: hex_to_color("#a3be8c"),
        warning: hex_to_color("#ebcb8b"),
        error: hex_to_color("#bf616a"),
        text: hex_to_color("#eceff4"),
        text_muted: hex_to_color("#7b88a1"),
        text_dim: hex_to_color("#434c5e"),
        surface: hex_to_color("#2e3440"),
    }
}

pub fn tokyo_night() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#7aa2f7"),
        primary_dim: hex_to_color("#7dcfff"),
        accent: hex_to_color("#9ece6a"),
        warning: hex_to_color("#e0af68"),
        error: hex_to_color("#f7768e"),
        text: hex_to_color("#c0caf5"),
        text_muted: hex_to_color("#565f89"),
        text_dim: hex_to_color("#3b4261"),
        surface: hex_to_color("#1a1b26"),
    }
}

pub fn gruvbox() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#83a598"),
        primary_dim: hex_to_color("#458588"),
        accent: hex_to_color("#b8bb26"),
        warning: hex_to_color("#fabd2f"),
        error: hex_to_color("#fb4934"),
        text: hex_to_color("#ebdbb2"),
        text_muted: hex_to_color("#928374"),
        text_dim: hex_to_color("#504945"),
        surface: hex_to_color("#282828"),
    }
}

pub fn solarized() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#268bd2"),
        primary_dim: hex_to_color("#2aa198"),
        accent: hex_to_color("#859900"),
        warning: hex_to_color("#b58900"),
        error: hex_to_color("#dc322f"),
        text: hex_to_color("#839496"),
        text_muted: hex_to_color("#586e75"),
        text_dim: hex_to_color("#073642"),
        surface: hex_to_color("#002b36"),
    }
}

pub fn rose_pine() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#c4a7e7"),
        primary_dim: hex_to_color("#9ccfd8"),
        accent: hex_to_color("#31748f"),
        warning: hex_to_color("#f6c177"),
        error: hex_to_color("#eb6f92"),
        text: hex_to_color("#e0def4"),
        text_muted: hex_to_color("#6e6a86"),
        text_dim: hex_to_color("#26233a"),
        surface: hex_to_color("#191724"),
    }
}

pub fn one_dark() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#61afef"),
        primary_dim: hex_to_color("#56b6c2"),
        accent: hex_to_color("#98c379"),
        warning: hex_to_color("#e5c07b"),
        error: hex_to_color("#e06c75"),
        text: hex_to_color("#abb2bf"),
        text_muted: hex_to_color("#5c6370"),
        text_dim: hex_to_color("#3e4451"),
        surface: hex_to_color("#282c34"),
    }
}

pub fn monokai() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#66d9ef"),
        primary_dim: hex_to_color("#a6e22e"),
        accent: hex_to_color("#a6e22e"),
        warning: hex_to_color("#e6db74"),
        error: hex_to_color("#f92672"),
        text: hex_to_color("#f8f8f2"),
        text_muted: hex_to_color("#75715e"),
        text_dim: hex_to_color("#49483e"),
        surface: hex_to_color("#272822"),
    }
}

pub fn github_dark() -> ThemeColors {
    ThemeColors {
        primary: hex_to_color("#58a6ff"),
        primary_dim: hex_to_color("#79c0ff"),
        accent: hex_to_color("#3fb950"),
        warning: hex_to_color("#d29922"),
        error: hex_to_color("#f85149"),
        text: hex_to_color("#c9d1d9"),
        text_muted: hex_to_color("#8b949e"),
        text_dim: hex_to_color("#30363d"),
        surface: hex_to_color("#0d1117"),
    }
}

/// Look up a theme by name.
pub fn get_theme(name: &str) -> Option<ThemeColors> {
    match name {
        "familiar" | "default" => Some(familiar()),
        "catppuccin" => Some(catppuccin()),
        "dracula" => Some(dracula()),
        "nord" => Some(nord()),
        "tokyo-night" => Some(tokyo_night()),
        "gruvbox" => Some(gruvbox()),
        "solarized" => Some(solarized()),
        "rose-pine" => Some(rose_pine()),
        "one-dark" => Some(one_dark()),
        "monokai" => Some(monokai()),
        "github-dark" => Some(github_dark()),
        _ => None,
    }
}

/// List all built-in theme names.
pub fn list_themes() -> Vec<&'static str> {
    vec![
        "familiar",
        "catppuccin",
        "dracula",
        "nord",
        "tokyo-night",
        "gruvbox",
        "solarized",
        "rose-pine",
        "one-dark",
        "monokai",
        "github-dark",
    ]
}
