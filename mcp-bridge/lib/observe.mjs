// Thin wrapper: write an observation to Familiar's SQLite memory DB via Bun subprocess.
// The MCP bridge runs under Node, but memory-db.js uses bun:sqlite,
// so we shell out to Bun to avoid native dependency issues.

import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_LIB = resolve(__dirname, "../../apps/cli/lib");

/**
 * Write an observation to the memory DB via Bun.
 *
 * @param {{ type: string, summary: string, project?: string, details?: string, tags?: string[], source?: string }} obs
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
export function writeObservation(obs) {
  const script = [
    `import { addObservation } from "${CLI_LIB}/memory-db.js";`,
    `const obs = JSON.parse(process.argv[1]);`,
    `const id = addObservation(obs);`,
    `console.log(JSON.stringify({ ok: true, id }));`,
  ].join("\n");

  try {
    const result = execFileSync("bun", ["-e", script, JSON.stringify(obs)], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return JSON.parse(result.trim());
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}
