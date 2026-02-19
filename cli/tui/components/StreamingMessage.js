import React, { useRef, useState, useEffect } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { colors } from "../lib/theme.js";
import { renderMarkdownSafe } from "../lib/markdown.js";

const e = React.createElement;

const THROTTLE_MS = 100;

export function StreamingMessage({ text, busy }) {
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

  // Busy but still waiting for first token
  if (busy && !text) {
    return e(Box, { marginLeft: 2, marginTop: 1 },
      e(Text, { color: colors.cyan },
        e(Spinner, { type: "dots" })
      ),
      e(Text, { color: colors.gray }, " Thinking...")
    );
  }

  // Streaming text arrived
  return e(Box, { flexDirection: "column", marginLeft: 2, marginTop: 1 },
    e(Box, null,
      e(Text, { color: colors.cyanDim, bold: true }, "engie"),
      e(Text, { color: colors.gray }, " "),
      busy
        ? e(Text, { color: colors.cyan }, e(Spinner, { type: "dots" }))
        : null
    ),
    e(Text, null, rendered || text)
  );
}
