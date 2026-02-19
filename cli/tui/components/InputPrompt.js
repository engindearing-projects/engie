import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../lib/theme.js";

const e = React.createElement;

export function InputPrompt({ value, onChange, onSubmit, disabled }) {
  if (disabled) {
    return e(Box, null,
      e(Text, { color: colors.grayDim }, "  engie > "),
      e(Text, { color: colors.grayDim }, "...")
    );
  }

  return e(Box, null,
    e(Text, { color: colors.cyan, bold: true }, "  engie"),
    e(Text, { color: colors.gray }, " > "),
    e(TextInput, {
      value,
      onChange,
      onSubmit,
      placeholder: "Type a message...",
    })
  );
}
