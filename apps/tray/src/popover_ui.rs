//! Embedded HTML/CSS/JS for the popover panel UI.
//!
//! Self-contained — no external dependencies. Dark theme with backdrop blur,
//! system font stack, and CSS custom properties for theming.
//!
//! JavaScript API:
//!   - `updateState(state)` — full state refresh from Rust
//!   - `addToolCall(name, time)` — prepend a single tool call to the feed
//!
//! IPC (JS → Rust):
//!   - `window.ipc.postMessage(JSON.stringify({ action: "restart" | "open_logs" | "settings" }))`

pub const POPOVER_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: rgba(30, 30, 30, 0.85);
    --bg-solid: #1e1e1e;
    --surface: rgba(255, 255, 255, 0.06);
    --surface-hover: rgba(255, 255, 255, 0.10);
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.12);
    --text-primary: rgba(255, 255, 255, 0.92);
    --text-secondary: rgba(255, 255, 255, 0.55);
    --text-tertiary: rgba(255, 255, 255, 0.35);
    --accent: #7c8aff;
    --accent-dim: rgba(124, 138, 255, 0.15);
    --green: #34d399;
    --red: #f87171;
    --orange: #fbbf24;
    --radius: 12px;
    --radius-sm: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    --font-mono: "SF Mono", "Cascadia Code", "Fira Code", "Consolas", monospace;
    --transition: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body {
    height: 100%;
    overflow: hidden;
    background: transparent;
    font-family: var(--font);
    font-size: 13px;
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    user-select: none;
    -webkit-user-select: none;
  }

  /* === Panel container === */
  #panel {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 220ms ease-out, transform 220ms ease-out;
  }

  #panel.visible {
    opacity: 1;
    transform: translateY(0);
  }

  /* Windows: panel rises from bottom instead */
  body.platform-windows #panel {
    transform: translateY(8px);
  }
  body.platform-windows #panel.visible {
    transform: translateY(0);
  }

  /* === Header === */
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), #a78bfa);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    flex-shrink: 0;
    letter-spacing: -0.5px;
  }

  .header-info {
    flex: 1;
    min-width: 0;
  }

  .header-name {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-sub {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 1px;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 6px;
    border-radius: 100px;
    background: var(--surface);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--red);
    flex-shrink: 0;
    transition: background var(--transition);
  }

  .dot.connected {
    background: var(--green);
    box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
  }

  /* === Activity feed === */
  .section-label {
    padding: 10px 16px 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .feed {
    flex: 1;
    overflow-y: auto;
    padding: 0 12px 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }

  .feed::-webkit-scrollbar {
    width: 4px;
  }
  .feed::-webkit-scrollbar-track {
    background: transparent;
  }
  .feed::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
  }

  .feed-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }

  .feed-item:hover {
    background: var(--surface);
  }

  .feed-icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: var(--accent-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 12px;
  }

  .feed-content {
    flex: 1;
    min-width: 0;
  }

  .feed-name {
    font-size: 12.5px;
    font-weight: 500;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.3px;
  }

  .feed-time {
    font-size: 10.5px;
    color: var(--text-tertiary);
    margin-top: 1px;
  }

  .feed-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
    font-style: italic;
    opacity: 0.7;
  }

  .feed-empty .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.5;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.9); }
    50% { opacity: 0.7; transform: scale(1.1); }
  }

  /* === Stats bar === */
  .stats {
    display: flex;
    gap: 1px;
    padding: 0 12px;
    margin: 4px 0;
    flex-shrink: 0;
  }

  .stat {
    flex: 1;
    text-align: center;
    padding: 8px 4px;
    background: var(--surface);
    transition: background var(--transition);
  }

  .stat:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .stat:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }

  .stat:hover {
    background: var(--surface-hover);
  }

  .stat-value {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }

  .stat-label {
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  /* === Quick actions === */
  .actions {
    display: flex;
    gap: 6px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 7px 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition);
    outline: none;
    -webkit-appearance: none;
  }

  .action-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .action-btn:active {
    transform: scale(0.97);
  }

  .action-btn svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  /* === Utility === */
  .fade-enter {
    animation: fadeSlideIn 200ms ease-out forwards;
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateX(-4px); }
    to   { opacity: 1; transform: translateX(0); }
  }
</style>
</head>
<body>
  <div id="panel">
    <!-- Header -->
    <div class="header">
      <div class="avatar" id="avatar">F</div>
      <div class="header-info">
        <div class="header-name" id="name">Familiar</div>
        <div class="header-sub" id="header-sub">AI Assistant</div>
      </div>
      <div class="status-badge">
        <span class="dot" id="status-dot"></span>
        <span id="status-text">Offline</span>
      </div>
    </div>

    <!-- Activity feed -->
    <div class="section-label">Recent Activity</div>
    <div class="feed" id="feed">
      <div class="feed-empty" id="feed-empty">
        <div class="pulse-dot"></div>
        <span>Listening for activity...</span>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="stat-tools">0</div>
        <div class="stat-label">Tools</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="stat-uptime">—</div>
        <div class="stat-label">Uptime</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="stat-calls">0</div>
        <div class="stat-label">Calls</div>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="actions">
      <button class="action-btn" onclick="ipcAction('restart')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/>
          <path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/>
          <path d="M11.5 2v2.5H14"/>
          <path d="M4.5 14v-2.5H2"/>
        </svg>
        Restart
      </button>
      <button class="action-btn" onclick="ipcAction('open_logs')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3h10v10H3z"/>
          <path d="M5.5 6h5M5.5 8h5M5.5 10h3"/>
        </svg>
        Logs
      </button>
      <button class="action-btn" onclick="ipcAction('settings')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8" cy="8" r="2.5"/>
          <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1"/>
        </svg>
        Settings
      </button>
    </div>
  </div>

<script>
(function() {
  "use strict";

  // --- Platform detection ---
  var ua = navigator.userAgent.toLowerCase();
  if (ua.indexOf("windows") !== -1) {
    document.body.classList.add("platform-windows");
  } else {
    document.body.classList.add("platform-macos");
  }

  // Panel entrance animation is triggered from Rust via showPanel().
  // Also add the panel's own visible class to match.
  window.showPanel = function() {
    document.body.classList.add("visible");
    document.getElementById("panel").classList.add("visible");
  };

  window.hidePanel = function() {
    document.body.classList.remove("visible");
    document.getElementById("panel").classList.remove("visible");
  };

  // --- Tool icon map ---
  var TOOL_ICONS = {
    "read":   "\u{1F4C4}",
    "write":  "\u{270F}\u{FE0F}",
    "edit":   "\u{270F}\u{FE0F}",
    "run":    "\u{25B6}\u{FE0F}",
    "search": "\u{1F50D}",
    "grep":   "\u{1F50D}",
    "list":   "\u{1F4CB}",
    "tree":   "\u{1F333}",
    "http":   "\u{1F310}",
    "think":  "\u{1F4AD}",
    "default":"\u{26A1}"
  };

  function getToolIcon(name) {
    if (!name) return TOOL_ICONS["default"];
    var lower = name.toLowerCase();
    for (var key in TOOL_ICONS) {
      if (key !== "default" && lower.indexOf(key) !== -1) {
        return TOOL_ICONS[key];
      }
    }
    return TOOL_ICONS["default"];
  }

  // --- Feed management ---
  var MAX_FEED_ITEMS = 5;

  function createFeedItem(name, time) {
    var item = document.createElement("div");
    item.className = "feed-item fade-enter";

    var icon = document.createElement("div");
    icon.className = "feed-icon";
    icon.textContent = getToolIcon(name);

    var content = document.createElement("div");
    content.className = "feed-content";

    var nameEl = document.createElement("div");
    nameEl.className = "feed-name";
    nameEl.textContent = name;

    var timeEl = document.createElement("div");
    timeEl.className = "feed-time";
    timeEl.textContent = time;

    content.appendChild(nameEl);
    content.appendChild(timeEl);
    item.appendChild(icon);
    item.appendChild(content);

    return item;
  }

  function renderFeed(tools) {
    var feed = document.getElementById("feed");
    var empty = document.getElementById("feed-empty");

    if (!tools || tools.length === 0) {
      feed.innerHTML = "";
      feed.appendChild(empty);
      empty.style.display = "block";
      return;
    }

    feed.innerHTML = "";
    var items = tools.slice(0, MAX_FEED_ITEMS);
    for (var i = 0; i < items.length; i++) {
      feed.appendChild(createFeedItem(items[i].name, items[i].time));
    }
  }

  // --- Public API: full state update ---
  window.updateState = function(state) {
    if (!state) return;

    // Name
    if (state.name) {
      document.getElementById("name").textContent = state.name;
      document.getElementById("avatar").textContent = state.name.charAt(0).toUpperCase();
    }

    // Connection status
    var dot = document.getElementById("status-dot");
    var statusText = document.getElementById("status-text");
    if (state.connected) {
      dot.className = "dot connected";
      statusText.textContent = "Online";
    } else {
      dot.className = "dot";
      statusText.textContent = "Offline";
    }

    // Activity feed
    if (state.lastTools) {
      renderFeed(state.lastTools);
    }

    // Stats
    if (state.toolCount !== undefined) {
      document.getElementById("stat-tools").textContent = formatNumber(state.toolCount);
    }
    if (state.uptime !== undefined) {
      document.getElementById("stat-uptime").textContent = state.uptime;
    }
    if (state.totalCalls !== undefined) {
      document.getElementById("stat-calls").textContent = formatNumber(state.totalCalls);
    }
  };

  // --- Public API: add single tool call ---
  window.addToolCall = function(name, time) {
    var feed = document.getElementById("feed");
    var empty = document.getElementById("feed-empty");

    // Hide empty state
    if (empty) {
      empty.style.display = "none";
    }

    // Prepend new item
    var item = createFeedItem(name, time);
    if (feed.firstChild) {
      feed.insertBefore(item, feed.firstChild);
    } else {
      feed.appendChild(item);
    }

    // Trim to max
    while (feed.children.length > MAX_FEED_ITEMS) {
      feed.removeChild(feed.lastChild);
    }
  };

  // --- IPC: send action to Rust ---
  window.ipcAction = function(action) {
    if (window.ipc && window.ipc.postMessage) {
      window.ipc.postMessage(JSON.stringify({ action: action }));
    }
  };

  // --- Helpers ---
  function formatNumber(n) {
    if (n >= 1000) {
      return (n / 1000).toFixed(1) + "k";
    }
    return String(n);
  }
})();
</script>
</body>
</html>"##;
