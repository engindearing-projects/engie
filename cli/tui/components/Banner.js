import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { colors, VERSION } from "../lib/theme.js";

const ACTIVITY_URL = `http://localhost:${process.env.ACTIVITY_PORT || 18790}`;

const e = React.createElement;

// Iris pulse — shape contracts/expands with a sine-wave color breath.
// Evokes an engine iris or aperture opening and closing.
// 24 steps at 130ms each = ~3.1s full breath cycle.
const PULSE_STEPS = 24;
const PULSE_FRAMES = (() => {
  const bright = [6, 182, 212];   // #06b6d4
  const dim = [12, 61, 74];       // #0c3d4a
  // Shapes by intensity band: contracted → expanded → contracted
  // Uses fixed-width padding so the label doesn't jitter
  const shapes = [
    { glyph: "·",  pad: " " },  // tiny seed
    { glyph: "•",  pad: " " },  // small dot
    { glyph: "●",  pad: " " },  // filled circle
    { glyph: "◉",  pad: " " },  // bullseye — peak
  ];
  const out = [];
  for (let i = 0; i < PULSE_STEPS; i++) {
    const t = (Math.sin((i / PULSE_STEPS) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    const r = Math.round(dim[0] + (bright[0] - dim[0]) * t);
    const g = Math.round(dim[1] + (bright[1] - dim[1]) * t);
    const b = Math.round(dim[2] + (bright[2] - dim[2]) * t);
    const color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    // Map t (0-1) to shape index
    const si = Math.min(Math.floor(t * shapes.length), shapes.length - 1);
    out.push({ color, ...shapes[si] });
  }
  return out;
})();

const STATIC_TIPS = [
  "/memory to search past context",
  "/observe to save a quick note",
  "/status for service health",
  "/help for all commands",
];

function getContextSafe() {
  try {
    const { getContext } = require("../../lib/profile.js");
    return getContext();
  } catch {
    return null;
  }
}

function buildContextLine(ctx) {
  if (!ctx) return "Type a message or /help for commands.";

  const parts = [];

  if (ctx.todayCount > 0) {
    parts.push(`${ctx.todayCount} observation${ctx.todayCount !== 1 ? "s" : ""} today`);
  }

  const ticketTags = new Set();
  if (ctx.recentObs && ctx.recentObs.length > 0) {
    for (const obs of ctx.recentObs) {
      if (obs.tags) {
        for (const tag of obs.tags) {
          if (/^[A-Z]+-\d+$/.test(tag)) {
            ticketTags.add(tag);
          }
        }
      }
    }
  }

  if (ticketTags.size > 0) {
    const sorted = [...ticketTags].sort();
    parts.push(`active: ${sorted.join(", ")}`);
  }

  if (parts.length === 0) return "Type a message or /help for commands.";
  return parts.join(" · ");
}

function buildTips(ctx) {
  const tips = [...STATIC_TIPS];
  if (ctx?.recentObs?.length > 0) {
    const latest = ctx.recentObs[0];
    const ago = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 60000);
    if (ago < 60) {
      tips.unshift(`last activity: ${latest.summary.slice(0, 50)}${latest.summary.length > 50 ? "…" : ""}`);
    }
  }
  if (ctx?.todayCount > 5) {
    tips.unshift(`busy day — ${ctx.todayCount} observations logged`);
  }
  return tips;
}

export function Banner() {
  const [pulseIdx, setPulseIdx] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [unreadInfo, setUnreadInfo] = useState(null);
  const ctxRef = useRef(getContextSafe());
  const tipsRef = useRef(buildTips(ctxRef.current));

  // Iris pulse: smooth sine-wave breathing, 130ms per step
  useEffect(() => {
    const id = setInterval(() => {
      setPulseIdx((i) => (i + 1) % PULSE_STEPS);
    }, 130);
    return () => clearInterval(id);
  }, []);

  // Tips: rotate every 30s
  useEffect(() => {
    const id = setInterval(() => {
      setTipIdx((i) => (i + 1) % tipsRef.current.length);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Fetch unread from activity server on mount, auto-mark-read
  useEffect(() => {
    fetch(`${ACTIVITY_URL}/unread?platform=cli`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((data) => {
        if (data.unreadCount > 0) {
          const platforms = [...new Set(data.latest.map((i) => i.platform))];
          setUnreadInfo(`${data.unreadCount} update${data.unreadCount !== 1 ? "s" : ""} from ${platforms.join(", ")}`);
          // Auto-mark-read after display
          const maxId = Math.max(...data.latest.map((i) => i.id));
          fetch(`${ACTIVITY_URL}/cursor`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform: "cli", last_seen_id: maxId }),
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const ctx = ctxRef.current;
  const greeting = ctx?.greeting || "Hello";
  const contextLine = buildContextLine(ctx);
  const tip = tipsRef.current[tipIdx % tipsRef.current.length];

  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Box, null,
      e(Text, { color: PULSE_FRAMES[pulseIdx].color }, PULSE_FRAMES[pulseIdx].glyph + PULSE_FRAMES[pulseIdx].pad),
      e(Text, { color: colors.cyan, bold: true }, "cozy"),
      e(Text, { color: colors.gray }, ` v${VERSION}`)
    ),
    e(Text, { color: colors.grayDim }, `${greeting}. ${contextLine}`),
    unreadInfo && e(Text, { color: colors.yellow }, `  ↳ ${unreadInfo}`),
    e(Text, { color: colors.gray }, `  tip: ${tip}`)
  );
}
