import React from "react";
import { Box, Text } from "ink";
import { colors } from "../lib/theme.js";

const e = React.createElement;

export function StatusBar({ services, session }) {
  const dots = (services || []).map((svc) => {
    const dotChar = svc.healthy ? "\u25CF" : "\u25CF";
    const dotColor = svc.healthy ? colors.green : colors.red;
    return e(React.Fragment, { key: svc.name },
      e(Text, { color: dotColor }, dotChar),
      e(Text, { color: colors.grayDim }, ` ${svc.name}  `)
    );
  });

  return e(Box, { marginLeft: 2, marginTop: 1 },
    ...dots,
    e(Text, { color: colors.grayDim }, "\u2502  "),
    e(Text, { color: colors.grayDim }, session || "")
  );
}
