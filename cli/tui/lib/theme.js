// CozyTerm TUI theme — semantic colors, branding

export const themes = {
  default: {
    primary: "#06b6d4",      // cyan — branding, active elements
    primaryDim: "#0891b2",   // dimmer cyan — labels
    accent: "#22c55e",       // green — success, healthy
    warning: "#eab308",      // yellow — warnings, unread
    error: "#ef4444",        // red — errors, unhealthy
    text: "#f9fafb",         // white — primary text
    textMuted: "#6b7280",    // gray — secondary text
    textDim: "#374151",      // dark gray — borders, separators
    surface: "#1f2937",      // dark bg for cards/panels
  },
};

// Active theme (reads ENGIE_THEME env var, defaults to "default")
export const theme = themes[process.env.ENGIE_THEME] || themes.default;

// Backward-compat alias — existing code uses colors.cyan etc.
export const colors = {
  cyan: theme.primary,
  cyanDim: theme.primaryDim,
  gray: theme.textMuted,
  grayDim: theme.textDim,
  white: theme.text,
  red: theme.error,
  yellow: theme.warning,
  green: theme.accent,
};

// Environment detection
export const NO_COLOR = !!process.env.NO_COLOR || process.env.TERM === "dumb";
export const NARROW = (process.stdout.columns || 80) < 60;

export const VERSION = "0.6.0";

/**
 * Time-of-day greeting.
 * Morning (5-12), Afternoon (12-17), Evening (17-21), Night (21-5)
 */
export function getGreetingTime() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 21) return "Evening";
  return "Night";
}
