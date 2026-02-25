import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../lib/theme.js";

const e = React.createElement;

export function InputPrompt({ value, onChange, onSubmit, busy, queueLength = 0 }) {
  const promptColor = busy ? colors.grayDim : colors.cyan;
  const promptBold = !busy;
  const placeholder = busy ? "Type to queue..." : "Type a message...";

  return e(Box, null,
    // Queue badge
    queueLength > 0
      ? e(Text, { color: colors.yellow }, `  [${queueLength} queued] `)
      : e(Text, null, "  "),
    e(Text, { color: promptColor, bold: promptBold }, "engie"),
    e(Text, { color: colors.gray }, " > "),
    e(TextInput, {
      value,
      onChange,
      onSubmit,
      placeholder,
    })
  );
}
