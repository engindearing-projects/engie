import React from "react";
import { Box, Text } from "ink";
import { colors } from "../lib/theme.js";

const e = React.createElement;

export function ThoughtMessage({ text }) {
  return e(Box, { flexDirection: "column", marginLeft: 4, marginBottom: 1 },
    e(Text, { color: colors.grayDim, dimColor: true }, `engie (thinking)`),
    e(Text, { color: colors.gray, dimColor: true }, text)
  );
}
