import React, { useRef, useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { colors, NO_COLOR } from "../lib/theme.js";
import { renderMarkdownSafe } from "../lib/markdown.js";

const e = React.createElement;

const THROTTLE_MS = 100;

// Friendly labels for tool names shown in the spinner
const TOOL_LABELS = {
  Read: "Reading",
  Grep: "Searching",
  Glob: "Finding files",
  Bash: "Running command",
  Edit: "Editing",
  Write: "Writing",
  WebFetch: "Fetching URL",
  WebSearch: "Searching web",
  mcp__atlassian__jira_search: "Searching Jira",
  mcp__atlassian__jira_get_issue: "Loading ticket",
  mcp__slack__slack_post_message: "Posting to Slack",
  mcp__slack__slack_get_channel_history: "Reading Slack",
  mcp__figma__get_screenshot: "Getting Figma screenshot",
};

function getToolLabel(toolName) {
  if (!toolName) return null;
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName] + "...";
  // Try prefix match for MCP tools
  for (const [key, label] of Object.entries(TOOL_LABELS)) {
    if (toolName.startsWith(key)) return label + "...";
  }
  // Fallback: humanize the tool name
  const cleaned = toolName.replace(/^mcp__\w+__/, "").replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + "...";
}

export function StreamingMessage({ text, busy, toolStage, dynamicStatus }) {
  const [rendered, setRendered] = useState("");
  const timerRef = useRef(null);
  const latestTextRef = useRef("");

  // Track latest text in ref for throttle callback
  latestTextRef.current = text;

  useEffect(() => {
    if (!text) {
      setRendered("");
      return;
    }

    // Throttle: only re-render markdown every THROTTLE_MS
    if (!timerRef.current) {
      // Render immediately on first text
      setRendered(renderMarkdownSafe(text));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Render the latest text when the throttle expires
        setRendered(renderMarkdownSafe(latestTextRef.current));
      }, THROTTLE_MS);
    }
  }, [text]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Not busy and no text — render nothing
  if (!busy && !text) return null;

  // Busy but still waiting for first token — show context-aware spinner
  if (busy && !text) {
    const label = dynamicStatus || getToolLabel(toolStage) || "Thinking...";
    const spinner = NO_COLOR
      ? e(Text, { color: colors.cyan }, "...")
      : e(Text, { color: colors.cyan }, e(Spinner, { type: "dots" }));

    return e(Box, { marginLeft: 2, marginTop: 1 },
      spinner,
      e(Text, { color: colors.gray }, ` ${label}`)
    );
  }

  // Streaming text arrived
  return e(Box, { flexDirection: "column", marginLeft: 2, marginTop: 1 },
    e(Box, null,
      e(Text, { color: colors.cyanDim, bold: true }, "engie"),
      e(Text, { color: colors.gray }, " "),
      busy
        ? (NO_COLOR
            ? e(Text, { color: colors.cyan }, "...")
            : e(Text, { color: colors.cyan }, e(Spinner, { type: "dots" })))
        : null
    ),
    e(Text, null, rendered || text)
  );
}
