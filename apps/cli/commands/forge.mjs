#!/usr/bin/env bun

// Forge CLI subcommand — delegates to the standalone forge-cli in trainer/
// Usage: engie forge <subcommand> [args]

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_CLI = resolve(__dirname, "..", "..", "trainer", "forge-cli.mjs");

export async function run({ args = [] } = {}) {
  const { run: forgeRun } = await import(FORGE_CLI);
  return forgeRun({ args });
}
