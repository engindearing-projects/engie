import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { colors, VERSION, NO_COLOR } from "../lib/theme.js";

const ACTIVITY_URL = `http://localhost:${process.env.ACTIVITY_PORT || 18790}`;

const e = React.createElement;

const STATIC_TIPS = [
  "/memory to search past context",
  "/observe to save a quick note",
  "/status for service health",
  "/mobile for phone access setup",
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
  return parts.join(" \u00B7 ");
}

function buildTips(ctx) {
  const tips = [...STATIC_TIPS];
  if (ctx?.recentObs?.length > 0) {
    const latest = ctx.recentObs[0];
    const ago = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 60000);
    if (ago < 60) {
      tips.unshift(`last activity: ${latest.summary.slice(0, 50)}${latest.summary.length > 50 ? "\u2026" : ""}`);
    }
  }
  if (ctx?.todayCount > 5) {
    tips.unshift(`busy day \u2014 ${ctx.todayCount} observations logged`);
  }
  return tips;
}

export function Banner() {
  const [tipIdx, setTipIdx] = useState(0);
  const [unreadInfo, setUnreadInfo] = useState(null);
  const ctxRef = useRef(getContextSafe());
  const tipsRef = useRef(buildTips(ctxRef.current));

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

  if (NO_COLOR) {
    return e(Box, { flexDirection: "column", marginBottom: 1 },
      e(Box, null,
        e(Text, null, "engie"),
        e(Text, null, ` \u00B7 v${VERSION}`)
      ),
      e(Text, null, `${greeting}. ${contextLine}`),
      unreadInfo && e(Text, null, `  > ${unreadInfo}`),
      e(Text, null, `  tip: ${tip}`)
    );
  }

  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Box, null,
      e(Text, { color: colors.cyan, bold: true }, "engie"),
      e(Text, { color: colors.gray }, ` \u00B7 v${VERSION}`)
    ),
    e(Text, { color: colors.grayDim }, `${greeting}. ${contextLine}`),
    unreadInfo && e(Text, { color: colors.yellow }, `  \u21B3 ${unreadInfo}`),
    e(Text, { color: colors.gray }, `  tip: ${tip}`)
  );
}
