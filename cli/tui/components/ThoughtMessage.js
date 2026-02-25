import React from "react";
import { Box, Text } from "ink";
import { colors } from "../lib/theme.js";

const e = React.createElement;

export function ThoughtMessage({ text }) {
  // Wrap text to fit inside the bubble (leave room for border + padding)
  const cols = process.stdout.columns || 80;
  const maxWidth = Math.min(cols - 10, 70);

  // Word-wrap the text into lines
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line.length + word.length + 1 > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
  }

  return e(Box, { flexDirection: "column", marginLeft: 4, marginBottom: 1 },
    // Thought bubble with rounded border
    e(Box, {
        flexDirection: "column",
        borderStyle: "round",
        borderColor: colors.grayDim,
        paddingLeft: 1,
        paddingRight: 1,
      },
      e(Text, { color: colors.gray, dimColor: true, italic: true },
        lines.join("\n")
      )
    ),
    // Thought trail — the classic bubble dots
    e(Text, { color: colors.grayDim, dimColor: true }, "      ○"),
    e(Text, { color: colors.grayDim, dimColor: true }, "     ○"),
    e(Text, { color: colors.grayDim, dimColor: true, bold: true },
      "    engie is thinking..."
    )
  );
}
