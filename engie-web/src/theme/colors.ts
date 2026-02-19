// Theme colors — synced with engie-mobile and shared/theme.js

export const colors = {
  // Backgrounds
  bg: '#0f172a',           // slate-900 — main background
  bgLight: '#1e293b',      // slate-800 — cards, input, user bubbles
  bgLighter: '#334155',    // slate-700 — borders, subtle highlights

  // Primary
  cyan: '#06b6d4',         // primary accent
  cyanDim: '#0891b2',      // dimmed cyan for secondary elements

  // Text
  white: '#f9fafb',        // primary text
  gray: '#94a3b8',         // slate-400 — secondary text
  grayMid: '#6b7280',      // gray-500
  grayDim: '#64748b',      // slate-500 — placeholders, muted
  grayDimmer: '#374151',   // gray-800

  // Status
  green: '#22c55e',        // connected / healthy
  yellow: '#eab308',       // connecting / warning
  red: '#ef4444',          // error / disconnected

  // Code blocks
  codeBg: '#1e293b',       // code block background
  codeBorder: '#334155',   // code block border
} as const;

export type ColorKey = keyof typeof colors;
