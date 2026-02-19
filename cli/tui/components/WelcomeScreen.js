// Welcome screen for the setup wizard.

import React from "react";
import { Box, Text } from "ink";
import { colors, VERSION } from "../lib/theme.js";

const e = React.createElement;

export function WelcomeScreen({ resuming }) {
  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Box, null,
      e(Text, { color: colors.cyan, bold: true }, "engie"),
      e(Text, { color: colors.gray }, ` v${VERSION} setup`)
    ),
    e(Text, null, ""),
    resuming
      ? e(Text, { color: colors.yellow }, "  Resuming setup...")
      : e(Box, { flexDirection: "column" },
          e(Text, { color: colors.white, bold: true }, "  Hey! I'm Engie."),
          e(Text, { color: colors.gray },
            "  Let's get me set up. This takes about 2 minutes.")
        )
  );
}
