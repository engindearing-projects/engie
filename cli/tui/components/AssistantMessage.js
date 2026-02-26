import React from "react";
import { Box, Text } from "ink";
import { colors } from "../lib/theme.js";
import { renderMarkdown } from "../lib/markdown.js";

const e = React.createElement;

export function AssistantMessage({ text }) {
  const rendered = renderMarkdown(text);
  return e(Box, { flexDirection: "column", marginLeft: 2, marginBottom: 1 },
    e(Text, { color: colors.cyanDim, bold: true }, "engie"),
    e(Text, null, rendered)
  );
}
