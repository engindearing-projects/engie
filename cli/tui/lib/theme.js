// Engie TUI theme — colors, branding

export const colors = {
  cyan: "#06b6d4",
  cyanDim: "#0891b2",
  gray: "#6b7280",
  grayDim: "#374151",
  white: "#f9fafb",
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
};

export const VERSION = "0.3.0";

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
