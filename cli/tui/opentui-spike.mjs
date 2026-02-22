#!/usr/bin/env bun
/**
 * OpenTUI Spike — Engie CLI TUI prototype
 *
 * Evaluates OpenTUI (@opentui/core v0.1.80) as a replacement for Ink v5.
 *
 * Three rendering strategies, tried in order:
 *   1. @opentui/react  (React.createElement, no JSX)
 *      KNOWN ISSUE: requires React >= 19 (react-reconciler 0.32 uses
 *      ReactSharedInternals.S which doesn't exist in React 18.3.1).
 *      Will fail at import time. Kept here for when we upgrade React.
 *
 *   2. @opentui/core   (imperative Renderable API — THIS IS THE ONE THAT WORKS)
 *      Uses BoxRenderable, TextRenderable, ScrollBoxRenderable directly.
 *      Yoga flexbox layout, Zig-backed GPU renderer via bun:ffi.
 *
 *   3. Raw ANSI        (DECSTBM scroll region fallback)
 *      Zero dependencies. Uses VT100 scroll regions for fixed header/footer.
 *
 * Usage:
 *   bun ~/engie/cli/tui/opentui-spike.mjs             # auto-fallback
 *   bun ~/engie/cli/tui/opentui-spike.mjs --react      # force strategy 1
 *   bun ~/engie/cli/tui/opentui-spike.mjs --core        # force strategy 2
 *   bun ~/engie/cli/tui/opentui-spike.mjs --ansi        # force strategy 3
 *
 * Findings:
 *   - @opentui/core is Bun-native, fast, true Yoga flexbox in the terminal
 *   - Imperative API is verbose but powerful (direct Renderable tree manipulation)
 *   - React bindings blocked until we upgrade from React 18 -> 19
 *   - ScrollBoxRenderable gives us proper scrollable content areas with scrollbars
 *   - TextRenderable supports word-wrap, fg/bg colors, text attributes (bold, etc.)
 *   - CliRenderer handles alternate screen, mouse, keyboard, resize automatically
 */

// ── Palette (matches tui/lib/theme.js) ───────────────────────────────
const COLORS = {
  cyan:    "#06b6d4",
  cyanDim: "#0891b2",
  gray:    "#6b7280",
  grayDim: "#374151",
  white:   "#f9fafb",
  green:   "#22c55e",
  yellow:  "#eab308",
  red:     "#ef4444",
  bgDark:  "#0f172a",
  bgBar:   "#1e293b",
};

const VERSION = "1.0";

// ── Sample messages for the scrollable area ──────────────────────────
const SAMPLE_MESSAGES = [
  { role: "user", text: "What tasks are on my sprint board?" },
  { role: "assistant", text: "Checking your active sprint via Jira..." },
  { role: "assistant", text: "Found 4 tickets in the current sprint:\n  PORT-9  Lab data API integration (In Progress)\n  PORT-12 Quest/Labcorp normalization (In Progress)\n  PORT-15 Clinical dashboard v1 (To Do)\n  PORT-17 Go-live checklist (To Do)" },
  { role: "user", text: "What's blocking PORT-9?" },
  { role: "assistant", text: "PORT-9 is blocked by:\n  AD-1200 Cognito pool mismatch (root cause found, PR pending)\n  AD-1205 Manual externalId insert (backlog)\n  AD-1206 AdminGetUser IAM permission (backlog)" },
  { role: "user", text: "/status" },
  { role: "system", text: "Gateway: connected | Ollama: running (llama3.1 8B) | Jira: authenticated" },
  { role: "user", text: "Draft a standup update for today" },
  { role: "assistant", text: "Here's a draft standup:\n\nYesterday:\n- Fixed Cognito pool mismatch root cause (AD-1200)\n- Updated Vercel env vars for dev environment\n- Opened devops PR #483 for Helm client IDs\n\nToday:\n- Waiting on PR #483 merge + redeploy\n- Continue PORT-12 normalization PRs\n- Test lab data endpoint once AD-1200 is resolved\n\nBlockers:\n- AD-1205 and AD-1206 still in backlog" },
];

// =====================================================================
// Strategy 1: @opentui/react  (React.createElement, no JSX)
// =====================================================================
async function tryOpenTUIReact() {
  const React = await import("react");
  const { useState } = React;
  const e = React.createElement;

  // This import will throw with React 18 — react-reconciler 0.32 needs React 19+
  const { createRoot, useKeyboard } = await import("@opentui/react");
  const { createCliRenderer } = await import("@opentui/core");

  function HeaderBar() {
    return e("box", {
      height: 1,
      backgroundColor: COLORS.bgBar,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
    },
      e("text", { fg: COLORS.cyan, attributes: 1 }, "● "),
      e("text", { fg: COLORS.cyan, attributes: 1 }, "Engie"),
      e("text", { fg: COLORS.gray }, ` v${VERSION}`),
      e("text", { fg: COLORS.grayDim }, " | "),
      e("text", { fg: COLORS.green }, "gateway"),
    );
  }

  function FooterBar() {
    return e("box", {
      height: 1,
      backgroundColor: COLORS.bgBar,
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
    },
      e("text", { fg: COLORS.green }, "● "),
      e("text", { fg: COLORS.gray }, "llama3.1"),
      e("text", { fg: COLORS.grayDim }, " | "),
      e("text", { fg: COLORS.cyan }, "ready"),
      e("text", { fg: COLORS.grayDim }, " | "),
      e("text", { fg: COLORS.grayDim }, "ctrl+c to exit"),
    );
  }

  function MessageArea() {
    const [msgs] = useState(SAMPLE_MESSAGES);

    return e("scrollbox", {
      flexGrow: 1,
      focused: true,
      stickyScroll: true,
      stickyStart: "bottom",
    },
      ...msgs.map((msg, i) => {
        const roleColor = msg.role === "user" ? COLORS.cyan
          : msg.role === "system" ? COLORS.yellow
          : COLORS.white;
        const label = msg.role === "user" ? "you"
          : msg.role === "system" ? "sys"
          : "engie";
        return e("box", { key: `msg-${i}`, paddingLeft: 1, paddingBottom: 1 },
          e("text", null,
            e("span", { fg: roleColor, attributes: 1 }, `${label}: `),
            e("span", { fg: COLORS.white }, msg.text)
          )
        );
      })
    );
  }

  function App() {
    useKeyboard((key) => {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        process.exit(0);
      }
    });

    return e("box", {
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: COLORS.bgDark,
    },
      e(HeaderBar),
      e(MessageArea),
      e(FooterBar),
    );
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  });
  createRoot(renderer).render(e(App));
}

// =====================================================================
// Strategy 2: @opentui/core imperative API
// =====================================================================
async function tryOpenTUICore() {
  const {
    createCliRenderer,
    TextRenderable,
    BoxRenderable,
    ScrollBoxRenderable,
    TextAttributes,
  } = await import("@opentui/core");

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  });

  const root = renderer.root;

  // ── Main container — column layout, full size ──
  const main = new BoxRenderable(renderer, {
    id: "main",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: COLORS.bgDark,
  });
  root.add(main);

  // ── Header bar (fixed height: 1) ──
  const header = new BoxRenderable(renderer, {
    id: "header",
    height: 1,
    width: "100%",
    backgroundColor: COLORS.bgBar,
    flexDirection: "row",
    paddingLeft: 1,
  });
  main.add(header);

  header.add(new TextRenderable(renderer, {
    id: "h-dot",
    content: "● ",
    fg: COLORS.cyan,
    attributes: TextAttributes.BOLD,
  }));
  header.add(new TextRenderable(renderer, {
    id: "h-title",
    content: "Engie",
    fg: COLORS.cyan,
    attributes: TextAttributes.BOLD,
  }));
  header.add(new TextRenderable(renderer, {
    id: "h-ver",
    content: ` v${VERSION}`,
    fg: COLORS.gray,
  }));
  header.add(new TextRenderable(renderer, {
    id: "h-sep1",
    content: " | ",
    fg: COLORS.grayDim,
  }));
  header.add(new TextRenderable(renderer, {
    id: "h-gw",
    content: "gateway",
    fg: COLORS.green,
  }));

  // ── Scrollable message area (flexGrow: 1 fills remaining space) ──
  const messageArea = new ScrollBoxRenderable(renderer, {
    id: "messages",
    flexGrow: 1,
    width: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
    contentOptions: {
      backgroundColor: COLORS.bgDark,
    },
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: COLORS.cyanDim,
        backgroundColor: COLORS.grayDim,
      },
    },
  });
  main.add(messageArea);

  // Populate sample messages
  for (let i = 0; i < SAMPLE_MESSAGES.length; i++) {
    const msg = SAMPLE_MESSAGES[i];
    const roleColor = msg.role === "user" ? COLORS.cyan
      : msg.role === "system" ? COLORS.yellow
      : COLORS.white;
    const label = msg.role === "user" ? "you"
      : msg.role === "system" ? "sys"
      : "engie";

    const msgBox = new BoxRenderable(renderer, {
      id: `msg-${i}`,
      paddingLeft: 1,
      paddingBottom: 1,
      width: "100%",
    });

    const msgText = new TextRenderable(renderer, {
      id: `msg-t-${i}`,
      content: `${label}: ${msg.text}`,
      fg: roleColor,
      wrapMode: "word",
      width: "100%",
    });

    msgBox.add(msgText);
    messageArea.add(msgBox);
  }

  // ── Footer bar (fixed height: 1) ──
  const footer = new BoxRenderable(renderer, {
    id: "footer",
    height: 1,
    width: "100%",
    backgroundColor: COLORS.bgBar,
    flexDirection: "row",
    paddingLeft: 1,
  });
  main.add(footer);

  footer.add(new TextRenderable(renderer, {
    id: "f-dot",
    content: "● ",
    fg: COLORS.green,
  }));
  footer.add(new TextRenderable(renderer, {
    id: "f-model",
    content: "llama3.1",
    fg: COLORS.gray,
  }));
  footer.add(new TextRenderable(renderer, {
    id: "f-sep1",
    content: " | ",
    fg: COLORS.grayDim,
  }));
  footer.add(new TextRenderable(renderer, {
    id: "f-ready",
    content: "ready",
    fg: COLORS.cyan,
  }));
  footer.add(new TextRenderable(renderer, {
    id: "f-sep2",
    content: " | ",
    fg: COLORS.grayDim,
  }));
  footer.add(new TextRenderable(renderer, {
    id: "f-hint",
    content: "ctrl+c to exit",
    fg: COLORS.grayDim,
  }));

  // Focus scroll area for keyboard navigation
  messageArea.focus();

  renderer.start();
}

// =====================================================================
// Strategy 3: Raw ANSI — DECSTBM scroll regions
// =====================================================================
async function tryRawAnsi() {
  const { stdout, stdin } = process;
  const cols = stdout.columns || 80;
  const rows = stdout.rows || 24;

  const ESC = "\x1b";
  const CSI = `${ESC}[`;
  const write = (s) => stdout.write(s);

  write(`${CSI}?1049h`);  // alternate screen
  write(`${CSI}?25l`);    // hide cursor

  const fg = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return `${CSI}38;2;${r};${g};${b}m`;
  };
  const bg = (hex) => {
    const [r, g, b] = hexToRgb(hex);
    return `${CSI}48;2;${r};${g};${b}m`;
  };
  const bold = `${CSI}1m`;
  const reset = `${CSI}0m`;

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  function moveTo(row, col) {
    write(`${CSI}${row};${col}H`);
  }

  function clearLine() {
    write(`${CSI}2K`);
  }

  function drawHeader() {
    moveTo(1, 1);
    clearLine();
    write(`${bg(COLORS.bgBar)}${fg(COLORS.cyan)}${bold} ● Engie${reset}`);
    write(`${bg(COLORS.bgBar)}${fg(COLORS.gray)} v${VERSION}`);
    write(`${fg(COLORS.grayDim)} | `);
    write(`${fg(COLORS.green)}gateway${reset}`);
    write(`${bg(COLORS.bgBar)}${" ".repeat(Math.max(0, cols - 28))}${reset}`);
  }

  function drawFooter() {
    moveTo(rows, 1);
    clearLine();
    write(`${bg(COLORS.bgBar)}${fg(COLORS.green)} ● `);
    write(`${fg(COLORS.gray)}llama3.1`);
    write(`${fg(COLORS.grayDim)} | `);
    write(`${fg(COLORS.cyan)}ready`);
    write(`${fg(COLORS.grayDim)} | ctrl+c to exit${reset}`);
    write(`${bg(COLORS.bgBar)}${" ".repeat(Math.max(0, cols - 42))}${reset}`);
  }

  function renderMessages() {
    // Set scroll region: rows 2 through rows-1
    write(`${CSI}2;${rows - 1}r`);

    let currentRow = 2;
    for (const msg of SAMPLE_MESSAGES) {
      if (currentRow > rows - 1) break;

      const roleColor = msg.role === "user" ? COLORS.cyan
        : msg.role === "system" ? COLORS.yellow
        : COLORS.white;
      const label = msg.role === "user" ? "you"
        : msg.role === "system" ? "sys"
        : "engie";

      const lines = msg.text.split("\n");
      for (let li = 0; li < lines.length; li++) {
        if (currentRow > rows - 1) break;
        moveTo(currentRow, 1);
        clearLine();

        if (li === 0) {
          write(`${bg(COLORS.bgDark)} ${fg(roleColor)}${bold}${label}:${reset}${bg(COLORS.bgDark)}${fg(COLORS.white)} ${lines[li]}${reset}`);
        } else {
          write(`${bg(COLORS.bgDark)} ${" ".repeat(label.length + 2)}${fg(COLORS.white)}${lines[li]}${reset}`);
        }
        currentRow++;
      }

      // Blank separator line
      if (currentRow <= rows - 1) {
        moveTo(currentRow, 1);
        clearLine();
        write(`${bg(COLORS.bgDark)}${" ".repeat(cols)}${reset}`);
        currentRow++;
      }
    }

    // Fill remaining rows
    while (currentRow <= rows - 1) {
      moveTo(currentRow, 1);
      clearLine();
      write(`${bg(COLORS.bgDark)}${" ".repeat(cols)}${reset}`);
      currentRow++;
    }

    // Reset scroll region to full screen
    write(`${CSI}r`);
  }

  function draw() {
    write(`${CSI}2J`);
    drawHeader();
    renderMessages();
    drawFooter();
  }

  draw();

  stdout.on("resize", draw);

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", (data) => {
      const key = data.toString();
      if (key === "\x03" || key === "q") {
        cleanup();
        process.exit(0);
      }
    });
  }

  function cleanup() {
    write(`${CSI}r`);
    write(`${CSI}?25h`);
    write(`${CSI}?1049l`);
  }

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}

// =====================================================================
// Main — try strategies in order (or force one with --flag)
// =====================================================================
async function main() {
  const args = process.argv.slice(2);
  const forceReact = args.includes("--react");
  const forceCore = args.includes("--core");
  const forceAnsi = args.includes("--ansi");

  const strategies = [];

  if (forceReact) {
    strategies.push({ name: "@opentui/react", fn: tryOpenTUIReact });
  } else if (forceCore) {
    strategies.push({ name: "@opentui/core", fn: tryOpenTUICore });
  } else if (forceAnsi) {
    strategies.push({ name: "Raw ANSI", fn: tryRawAnsi });
  } else {
    // Default: try all in order
    strategies.push(
      { name: "@opentui/react", fn: tryOpenTUIReact },
      { name: "@opentui/core imperative", fn: tryOpenTUICore },
      { name: "Raw ANSI DECSTBM", fn: tryRawAnsi },
    );
  }

  for (const { name, fn } of strategies) {
    try {
      console.error(`[spike] Trying: ${name} ...`);
      await fn();
      console.error(`[spike] Running: ${name}`);
      return;
    } catch (err) {
      console.error(`[spike] ${name} failed: ${err.message}`);
      if (err.stack) {
        console.error(err.stack.split("\n").slice(0, 4).join("\n"));
      }
    }
  }

  console.error("[spike] All strategies failed.");
  process.exit(1);
}

main();
