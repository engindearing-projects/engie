// Thin wrappers: read from Familiar's SQLite memory DB via Bun subprocess.
// Same pattern as observe.mjs — MCP bridge runs under Node, memory-db.js uses bun:sqlite.

import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_LIB = resolve(__dirname, "../../apps/cli/lib");

function bunExec(script, args = []) {
  try {
    const result = execFileSync("bun", ["-e", script, ...args], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(result.trim());
  } catch (err) {
    return { error: err.stderr || err.message };
  }
}

/** Get recent observations across all projects. */
export function queryRecent(limit = 10) {
  return bunExec([
    `import { getRecentAll } from "${CLI_LIB}/memory-db.js";`,
    `const limit = parseInt(process.argv[1]) || 10;`,
    `console.log(JSON.stringify(getRecentAll(limit)));`,
  ].join("\n"), [String(limit)]);
}

/** Full-text search with optional filters. Quotes the query for FTS5 safety. */
export function querySearch(query, opts = {}) {
  // FTS5 treats hyphens as column operators — quote the query to search literally
  const safeQuery = `"${query.replace(/"/g, '""')}"`;
  return bunExec([
    `import { search } from "${CLI_LIB}/memory-db.js";`,
    `const args = JSON.parse(process.argv[1]);`,
    `console.log(JSON.stringify(search(args.query, args.opts)));`,
  ].join("\n"), [JSON.stringify({ query: safeQuery, opts })]);
}

/** Get observation count and DB stats. */
export function queryStats() {
  return bunExec([
    `import { getStats } from "${CLI_LIB}/memory-db.js";`,
    `console.log(JSON.stringify(getStats()));`,
  ].join("\n"));
}

/** Read the user profile and preferences. */
export function queryProfile() {
  return bunExec([
    `import { readProfile, getPreference } from "${CLI_LIB}/profile.js";`,
    `import { readFileSync, existsSync } from "fs";`,
    `import { profileDir } from "${CLI_LIB}/paths.js";`,
    `import { join } from "path";`,
    `const profile = readProfile();`,
    `const prefsPath = join(profileDir(), "preferences.json");`,
    `let preferences = {};`,
    `try { if (existsSync(prefsPath)) preferences = JSON.parse(readFileSync(prefsPath, "utf-8")); } catch {}`,
    `console.log(JSON.stringify({ profile, preferences }));`,
  ].join("\n"));
}
