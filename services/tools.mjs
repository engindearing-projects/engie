#!/usr/bin/env bun

// Familiar-Coder Tool Definitions + Executors
// Provides 10 tools for the agentic tool loop: bash, read_file, write_file,
// edit_file, glob, grep, memory_search, memory_store, memory_recent, list_tools.
//
// Each tool has a schema (for system prompt injection) and an executor function.
// Bash commands are safety-checked against a blocklist before execution.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const HOME = process.env.HOME || "/tmp";
const DEFAULT_CWD = resolve(HOME, "familiar/workspace");
const BASH_TIMEOUT_MS = 30_000;
const MAX_BASH_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 8000;

/** Expand ~ to home directory in paths */
function expandPath(p) {
  if (!p) return p;
  if (p.startsWith("~/")) return resolve(HOME, p.slice(2));
  if (p === "~") return HOME;
  return p;
}

// ── Bash Safety ─────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-f\b/,
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bmkfs\b/,
  /\bcurl\s.*\|\s*bash\b/,
  /\bwget\s.*\|\s*bash\b/,
  /\bnpm\s+publish\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bsystemctl\s+(stop|restart|disable)\b/,
  /\blaunchctl\s+(unload|remove)\b/,
];

export function checkBashSafety(command) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { allowed: true, reason: null };
}

// ── Tool Schemas ────────────────────────────────────────────────────────────

const TOOL_SCHEMAS = [
  {
    name: "bash",
    description: "Run a shell command and return its output. Commands are safety-checked — destructive operations are blocked.",
    parameters: {
      command: { type: "string", description: "The shell command to execute", required: true },
      timeout: { type: "number", description: "Timeout in milliseconds (default 30000, max 60000)" },
      cwd: { type: "string", description: "Working directory (default: ~/familiar/workspace)" },
    },
  },
  {
    name: "read_file",
    description: "Read a file and return its contents with line numbers. Use this before modifying files.",
    parameters: {
      path: { type: "string", description: "Absolute path to the file", required: true },
      offset: { type: "number", description: "Line number to start from (1-based)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed. Use read_file first to understand existing content.",
    parameters: {
      path: { type: "string", description: "Absolute path to the file", required: true },
      content: { type: "string", description: "The content to write", required: true },
    },
  },
  {
    name: "edit_file",
    description: "Make a targeted edit to a file by replacing an exact string match. Preferred over write_file for modifying existing files — always read_file first to get exact content.",
    parameters: {
      path: { type: "string", description: "Absolute path to the file", required: true },
      old_string: { type: "string", description: "Exact text to find (must be unique in file unless replace_all is true)", required: true },
      new_string: { type: "string", description: "Replacement text", required: true },
      replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern. Returns file paths sorted by modification time.",
    parameters: {
      pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.mjs')", required: true },
      path: { type: "string", description: "Directory to search in (default: current working directory)" },
    },
  },
  {
    name: "grep",
    description: "Search file contents using ripgrep. Returns matching lines with file paths and line numbers.",
    parameters: {
      pattern: { type: "string", description: "Regex pattern to search for", required: true },
      path: { type: "string", description: "File or directory to search in" },
      glob: { type: "string", description: "File glob filter (e.g. '*.js')" },
      max_results: { type: "number", description: "Maximum number of results (default 20)" },
    },
  },
  {
    name: "memory_search",
    description: "Search Familiar's memory database using full-text search. Returns past observations, decisions, and findings.",
    parameters: {
      query: { type: "string", description: "Search query", required: true },
      type: { type: "string", description: "Filter by type (task_update, decision, blocker, insight)" },
      project: { type: "string", description: "Filter by project name" },
      limit: { type: "number", description: "Max results (default 10)" },
    },
  },
  {
    name: "memory_store",
    description: "Store a new observation in Familiar's memory database. Use this for important decisions, findings, or task updates.",
    parameters: {
      type: { type: "string", description: "Observation type: task_update, decision, blocker, insight, note", required: true },
      summary: { type: "string", description: "Brief summary of the observation", required: true },
      details: { type: "string", description: "Full details" },
      project: { type: "string", description: "Project name" },
      tags: { type: "array", description: "Tags for categorization" },
    },
  },
  {
    name: "memory_recent",
    description: "Get recent observations from Familiar's memory. Useful for understanding recent context.",
    parameters: {
      limit: { type: "number", description: "Number of recent observations (default 10)" },
      project: { type: "string", description: "Filter by project name" },
    },
  },
  {
    name: "list_tools",
    description: "List all available tools and system capabilities. Use this to discover what you can do.",
    parameters: {},
  },
];

// ── Tool Executors ──────────────────────────────────────────────────────────

function truncateOutput(output) {
  if (output.length > MAX_OUTPUT_CHARS) {
    return output.slice(0, MAX_OUTPUT_CHARS) + `\n... (truncated, ${output.length} total chars)`;
  }
  return output;
}

async function executeBash(args, context) {
  const { command, timeout, cwd } = args;
  if (!command) return { ok: false, result: "Error: command is required" };

  const safety = checkBashSafety(command);
  if (!safety.allowed) {
    return { ok: false, result: `Command blocked: ${safety.reason}` };
  }

  const timeoutMs = Math.min(timeout || BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS);
  const workDir = cwd || context?.cwd || DEFAULT_CWD;

  try {
    const output = execSync(command, {
      cwd: workDir,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME },
      maxBuffer: 1024 * 1024,
    }).toString();
    return { ok: true, result: truncateOutput(output) };
  } catch (err) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    const output = (stdout + "\n" + stderr).trim();
    return { ok: false, result: truncateOutput(`Exit code ${err.status || 1}\n${output}`) };
  }
}

function executeReadFile(args) {
  const { path: filePath, offset, limit } = args;
  if (!filePath) return { ok: false, result: "Error: path is required" };
  const resolvedPath = expandPath(filePath);

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, (offset || 1) - 1);
    const end = limit ? start + limit : lines.length;
    const slice = lines.slice(start, end);

    const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
    return { ok: true, result: truncateOutput(numbered) };
  } catch (err) {
    return { ok: false, result: `Error reading file: ${err.message}` };
  }
}

function executeWriteFile(args) {
  const { path: filePath, content } = args;
  if (!filePath) return { ok: false, result: "Error: path is required" };
  if (content === undefined || content === null) return { ok: false, result: "Error: content is required" };
  const resolvedPath = expandPath(filePath);

  try {
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(resolvedPath, content, "utf-8");
    return { ok: true, result: `Wrote ${content.length} chars to ${resolvedPath}` };
  } catch (err) {
    return { ok: false, result: `Error writing file: ${err.message}` };
  }
}

function executeEditFile(args) {
  const { path: filePath, old_string: oldStr, new_string: newStr, replace_all: replaceAll } = args;
  if (!filePath) return { ok: false, result: "Error: path is required" };
  if (oldStr === undefined || oldStr === null) return { ok: false, result: "Error: old_string is required" };
  if (newStr === undefined || newStr === null) return { ok: false, result: "Error: new_string is required" };
  if (oldStr === newStr) return { ok: false, result: "Error: old_string and new_string are identical" };

  const resolvedPath = expandPath(filePath);

  let content;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    return { ok: false, result: `Error reading file: ${err.message}` };
  }

  // Count occurrences
  let count = 0;
  let searchPos = 0;
  while (true) {
    const idx = content.indexOf(oldStr, searchPos);
    if (idx === -1) break;
    count++;
    searchPos = idx + oldStr.length;
  }

  // No matches — provide a helpful hint
  if (count === 0) {
    const lines = content.split("\n");
    // Extract keywords from old_string (words 3+ chars)
    const keywords = oldStr.match(/\b\w{3,}\b/g) || [];
    const hints = [];
    for (const kw of keywords.slice(0, 5)) {
      const kwLower = kw.toLowerCase();
      for (let i = 0; i < lines.length && hints.length < 5; i++) {
        if (lines[i].toLowerCase().includes(kwLower)) {
          hints.push(`  L${i + 1}: ${lines[i].trimEnd().slice(0, 120)}`);
        }
      }
    }
    // Deduplicate hints
    const uniqueHints = [...new Set(hints)].slice(0, 5);
    let msg = `Error: old_string not found in ${resolvedPath}`;
    if (uniqueHints.length > 0) {
      msg += `\nDid you mean one of these lines?\n${uniqueHints.join("\n")}`;
    }
    msg += `\nHint: Use read_file first to see the exact file contents.`;
    return { ok: false, result: msg };
  }

  // Multiple matches without replace_all
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      result: `Error: ${count} matches found for old_string in ${resolvedPath}. Provide more surrounding context to make it unique, or set replace_all: true.`,
    };
  }

  // Apply replacement
  const updated = replaceAll
    ? content.replaceAll(oldStr, newStr)
    : content.replace(oldStr, newStr);

  try {
    writeFileSync(resolvedPath, updated, "utf-8");
  } catch (err) {
    return { ok: false, result: `Error writing file: ${err.message}` };
  }

  // Build context around the edit site (show ~3 lines around first replacement)
  const updatedLines = updated.split("\n");
  const firstNewIdx = updated.indexOf(newStr);
  let contextSnippet = "";
  if (firstNewIdx !== -1) {
    const lineNum = updated.slice(0, firstNewIdx).split("\n").length;
    const start = Math.max(0, lineNum - 2);
    const end = Math.min(updatedLines.length, lineNum + newStr.split("\n").length + 1);
    contextSnippet = updatedLines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}\t${line}`)
      .join("\n");
  }

  const plural = replaceAll && count > 1 ? ` (${count} occurrences)` : "";
  return {
    ok: true,
    result: `Edited ${resolvedPath}${plural}\n${contextSnippet}`,
  };
}

async function executeGlob(args, context) {
  const { pattern, path: searchPath } = args;
  if (!pattern) return { ok: false, result: "Error: pattern is required" };

  const cwd = expandPath(searchPath) || context?.cwd || DEFAULT_CWD;

  try {
    // Use Bun.Glob if available (we run on Bun), otherwise fall back to find
    if (typeof Bun !== "undefined" && Bun.Glob) {
      const glob = new Bun.Glob(pattern);
      const results = [];
      for await (const entry of glob.scan({ cwd, dot: false })) {
        results.push(resolve(cwd, entry));
        if (results.length >= 200) break;
      }
      return { ok: true, result: results.join("\n") || "(no matches)" };
    }

    // Fallback: use find with basic glob support
    const output = execSync(`find "${cwd}" -name "${pattern}" -type f 2>/dev/null | head -200`, {
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
    return { ok: true, result: output || "(no matches)" };
  } catch (err) {
    return { ok: false, result: `Error: ${err.message}` };
  }
}

function executeGrep(args, context) {
  const { pattern, path: searchPath, glob: fileGlob, max_results } = args;
  if (!pattern) return { ok: false, result: "Error: pattern is required" };

  const cwd = expandPath(searchPath) || context?.cwd || DEFAULT_CWD;
  const limit = max_results || 20;

  // Build ripgrep command — use the actual binary, not the alias
  const rgBin = "/opt/homebrew/bin/rg";
  let cmd = `${rgBin} -n --max-count ${limit}`;
  if (fileGlob) cmd += ` --glob "${fileGlob}"`;
  cmd += ` "${pattern}" "${cwd}"`;

  try {
    const output = execSync(cmd, {
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    }).toString();
    return { ok: true, result: truncateOutput(output) };
  } catch (err) {
    if (err.status === 1) {
      return { ok: true, result: "(no matches)" };
    }
    return { ok: false, result: `Error: ${err.stderr?.toString() || err.message}` };
  }
}

// ── Memory Tools (lazy-loaded) ──────────────────────────────────────────────

let _memoryDb = null;
async function getMemoryDb() {
  if (_memoryDb) return _memoryDb;
  try {
    _memoryDb = await import("../apps/cli/lib/memory-db.js");
    return _memoryDb;
  } catch (err) {
    console.error("[Tools] Memory DB import failed:", err.message);
    return null;
  }
}

async function executeMemorySearch(args) {
  const db = await getMemoryDb();
  if (!db) return { ok: false, result: "Memory DB unavailable" };

  const { query, type, project, limit } = args;
  if (!query) return { ok: false, result: "Error: query is required" };

  try {
    const results = db.search(query, { type, project, limit: limit || 10 });
    if (results.length === 0) return { ok: true, result: "(no results)" };

    const formatted = results.map(r =>
      `[${r.type}] ${r.timestamp.slice(0, 16)} — ${r.summary}${r.project ? ` (${r.project})` : ""}`
    ).join("\n");
    return { ok: true, result: formatted };
  } catch (err) {
    return { ok: false, result: `Memory search error: ${err.message}` };
  }
}

async function executeMemoryStore(args) {
  const db = await getMemoryDb();
  if (!db) return { ok: false, result: "Memory DB unavailable" };

  const { type, summary, details, project, tags } = args;
  if (!type || !summary) return { ok: false, result: "Error: type and summary are required" };

  try {
    const id = db.addObservation({ type, summary, details, project, tags, source: "familiar" });
    return { ok: true, result: `Stored observation ${id}: ${summary}` };
  } catch (err) {
    return { ok: false, result: `Memory store error: ${err.message}` };
  }
}

async function executeMemoryRecent(args) {
  const db = await getMemoryDb();
  if (!db) return { ok: false, result: "Memory DB unavailable" };

  const { limit, project } = args;

  try {
    const results = project
      ? db.getRecentContext(project, limit || 10)
      : db.getRecentAll(limit || 10);

    if (results.length === 0) return { ok: true, result: "(no recent observations)" };

    const formatted = results.map(r =>
      `[${r.type}] ${r.timestamp.slice(0, 16)} — ${r.summary}${r.project ? ` (${r.project})` : ""}`
    ).join("\n");
    return { ok: true, result: formatted };
  } catch (err) {
    return { ok: false, result: `Memory recent error: ${err.message}` };
  }
}

function executeListTools() {
  const toolList = TOOL_SCHEMAS.map(t =>
    `- **${t.name}**: ${t.description}`
  ).join("\n");

  // Check system capabilities
  const capabilities = [];
  try { execSync("which git", { stdio: "pipe" }); capabilities.push("git"); } catch {}
  try { execSync("which node", { stdio: "pipe" }); capabilities.push("node"); } catch {}
  try { execSync("which bun", { stdio: "pipe" }); capabilities.push("bun"); } catch {}
  try { execSync("which npm", { stdio: "pipe" }); capabilities.push("npm"); } catch {}
  try { execSync("/opt/homebrew/bin/rg --version", { stdio: "pipe" }); capabilities.push("ripgrep"); } catch {}
  try { execSync("which python3", { stdio: "pipe" }); capabilities.push("python3"); } catch {}
  try { execSync("which gh", { stdio: "pipe" }); capabilities.push("gh (GitHub CLI)"); } catch {}

  // Include daemon tools if connected
  let daemonSection = "";
  if (_daemonToolNames && _daemonToolNames.size > 0) {
    daemonSection = `\n\n## Computer Tools (familiar-daemon)\n${[..._daemonToolNames].map(n => `- **${n}**`).join("\n")}`;
  } else if (existsSync(DAEMON_BIN)) {
    daemonSection = "\n\n## Computer Tools\nfamiliar-daemon available but not connected. Call any daemon tool to activate.";
  }

  // Include external MCP server tools
  let mcpSection = "";
  for (const [name, server] of _mcpServers) {
    if (server.schemaText) {
      const label = name === "atlassian" ? "Jira" : name.charAt(0).toUpperCase() + name.slice(1);
      mcpSection += `\n\n## ${label} Tools (${server.toolNames?.size || 0} tools)\n${server.schemaText}`;
    }
  }

  return {
    ok: true,
    result: `## Available Tools\n\n${toolList}\n\n## System Capabilities\nInstalled: ${capabilities.join(", ")}${daemonSection}${mcpSection}`,
  };
}

// ── MCP Daemon Bridge ───────────────────────────────────────────────────────
// Lazy-loads the Rust daemon (familiar-daemon) as an MCP server.
// Gives familiar-coder access to 50+ computer tools: screenshots, windows,
// input simulation, clipboard, OCR, accessibility, browser, audio, etc.
// The daemon only spawns when a daemon tool is actually called.

import { McpClient } from "./mcp-client.mjs";

const DAEMON_BIN = resolve(dirname(new URL(import.meta.url).pathname), "..", "daemon", "target", "release", "familiar-daemon");

let _daemonClient = null;
let _daemonToolNames = null;
let _daemonSchemaText = null;

async function getDaemonClient() {
  if (_daemonClient?.connected) return _daemonClient;

  // Check if daemon binary exists
  if (!existsSync(DAEMON_BIN)) {
    console.warn(`[tools] Daemon binary not found: ${DAEMON_BIN}`);
    return null;
  }

  try {
    _daemonClient = new McpClient({
      command: DAEMON_BIN,
      args: [],
      env: { RUST_LOG: "warn" },
    });
    await _daemonClient.connect();
    _daemonToolNames = new Set(await _daemonClient.getToolNames());
    _daemonSchemaText = await _daemonClient.getToolSchemaText();
    console.log(`[tools] Daemon connected: ${_daemonToolNames.size} tools available`);
    return _daemonClient;
  } catch (err) {
    console.warn(`[tools] Daemon connect failed: ${err.message}`);
    _daemonClient = null;
    return null;
  }
}

/** Check if a tool name belongs to the daemon. */
async function isDaemonTool(name) {
  if (_daemonToolNames) return _daemonToolNames.has(name);
  // Try to connect to discover tools
  const client = await getDaemonClient();
  if (!client) return false;
  return _daemonToolNames.has(name);
}

/** Execute a daemon tool via MCP. */
async function executeDaemonTool(name, args) {
  const client = await getDaemonClient();
  if (!client) return { ok: false, result: `Daemon unavailable — familiar-daemon not running` };

  try {
    const result = await client.callTool(name, args);
    // MCP returns { content: [{ type: "text", text: "..." }], isError?: boolean }
    const text = (result.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { ok: !result.isError, result: text || "(no output)" };
  } catch (err) {
    return { ok: false, result: `Daemon error: ${err.message}` };
  }
}

// ── External MCP Server Bridge ──────────────────────────────────────────────
// Loads MCP servers (Jira, Slack, etc.) from config/mcp-tools.json.
// Each server is lazy-loaded on first tool call. Promoted tools get full
// schemas in the system prompt; all tools are callable.

const PROJECT_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const MCP_CONFIG_PATH = resolve(PROJECT_ROOT, "config", "mcp-tools.json");

// Promoted tools per server — get full schemas in system prompt.
// Other tools are still callable but must be discovered via list_tools.
const PROMOTED_TOOLS = {
  atlassian: new Set([
    "jira_search",
    "jira_get_issue",
    "jira_get_all_projects",
    "jira_get_agile_boards",
    "jira_get_sprints_from_board",
    "jira_get_sprint_issues",
    "jira_get_board_issues",
    "jira_get_project_issues",
    "jira_create_issue",
    "jira_update_issue",
    "jira_add_comment",
    "jira_transition_issue",
    "jira_get_transitions",
  ]),
};

// server name → { config, client, toolNames, schemaText, promotedSchemaText }
const _mcpServers = new Map();
// tool name → server name (built lazily)
let _mcpToolMap = new Map();

function loadMcpConfig() {
  if (_mcpServers.size > 0) return;
  try {
    const config = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
    for (const [name, serverConfig] of Object.entries(config.mcpServers || {})) {
      // Skip familiar-daemon — handled by dedicated bridge above
      if (name === "familiar-daemon") continue;
      _mcpServers.set(name, {
        config: serverConfig,
        client: null,
        toolNames: null,
        schemaText: null,
        promotedSchemaText: null,
      });
    }
  } catch (err) {
    console.warn(`[tools] MCP config load failed: ${err.message}`);
  }
}

async function getMcpClient(serverName) {
  loadMcpConfig();
  const server = _mcpServers.get(serverName);
  if (!server) return null;
  if (server.client?.connected) return server.client;

  try {
    server.client = new McpClient({
      command: server.config.command,
      args: server.config.args || [],
      env: server.config.env || {},
    });
    await server.client.connect();

    const tools = await server.client.listTools();
    server.toolNames = new Set(tools.map(t => t.name));

    // Register all tools in the global map
    for (const toolName of server.toolNames) {
      _mcpToolMap.set(toolName, serverName);
    }

    // Build promoted schema text (subset for system prompt)
    const promoted = PROMOTED_TOOLS[serverName];
    const promotedTools = promoted
      ? tools.filter(t => promoted.has(t.name))
      : tools.slice(0, 10); // default: first 10

    server.promotedSchemaText = promotedTools.map(tool => {
      const params = tool.inputSchema?.properties || {};
      const required = new Set(tool.inputSchema?.required || []);
      const paramLines = Object.entries(params).map(([name, def]) => {
        const req = required.has(name) ? " (required)" : "";
        return `  - ${name}: ${def.type || "any"}${req} — ${def.description || ""}`;
      });
      const paramText = paramLines.length > 0 ? paramLines.join("\n") : "(no parameters)";
      return `### ${tool.name}\n${tool.description || ""}\nParameters:\n${paramText}`;
    }).join("\n\n");

    // Full schema text (for list_tools)
    server.schemaText = tools.map(t => `- **${t.name}**: ${t.description || ""}`).join("\n");

    console.log(`[tools] MCP ${serverName} connected: ${server.toolNames.size} tools (${promotedTools.length} promoted)`);
    return server.client;
  } catch (err) {
    console.warn(`[tools] MCP ${serverName} connect failed: ${err.message}`);
    server.client = null;
    return null;
  }
}

/** Check if a tool name belongs to an external MCP server. */
async function isMcpTool(name) {
  if (_mcpToolMap.has(name)) return true;
  // If servers haven't been loaded yet, try loading config
  loadMcpConfig();
  // Check if any unconnected server might have this tool
  for (const [serverName, server] of _mcpServers) {
    if (server.toolNames === null) {
      // This server hasn't been connected yet — check by name prefix
      if (name.startsWith("jira_") && serverName === "atlassian") return true;
      if (name.startsWith("slack_") && serverName === "slack") return true;
      if (name.startsWith("figma_") && serverName === "figma") return true;
    }
  }
  return false;
}

/** Execute a tool on an external MCP server. */
async function executeMcpTool(name, args) {
  // Find which server owns this tool
  let serverName = _mcpToolMap.get(name);

  // If not in map yet, try to connect the right server by prefix
  if (!serverName) {
    if (name.startsWith("jira_")) serverName = "atlassian";
    else if (name.startsWith("slack_")) serverName = "slack";
    else if (name.startsWith("figma_")) serverName = "figma";
  }

  if (!serverName) return { ok: false, result: `Unknown MCP tool: ${name}` };

  const client = await getMcpClient(serverName);
  if (!client) return { ok: false, result: `MCP server ${serverName} unavailable` };

  try {
    const result = await client.callTool(name, args);
    const text = (result.content || [])
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("\n");
    return { ok: !result.isError, result: truncateOutput(text || "(no output)") };
  } catch (err) {
    return { ok: false, result: `MCP ${serverName} error: ${err.message}` };
  }
}

/** Pre-warm an MCP server. Call at startup if desired. */
export async function warmMcpServer(serverName) {
  await getMcpClient(serverName);
}

/** Pre-warm all configured MCP servers. */
export async function warmMcpServers() {
  loadMcpConfig();
  const results = [];
  for (const serverName of _mcpServers.keys()) {
    results.push(getMcpClient(serverName).catch(() => null));
  }
  await Promise.allSettled(results);
}

/** Get promoted schema text from external MCP servers (for system prompt). */
function getMcpSchemaText() {
  const sections = [];
  for (const [name, server] of _mcpServers) {
    if (server.promotedSchemaText) {
      const label = name === "atlassian" ? "Jira" : name.charAt(0).toUpperCase() + name.slice(1);
      sections.push(`## ${label} Tools (via ${name} MCP)\n\n${server.promotedSchemaText}`);
    }
  }
  return sections.join("\n\n");
}

// ── Brain Skills ────────────────────────────────────────────────────────────
// Loads skills from brain/skills/registry.json and makes them callable.
// New skills are sandboxed (read-only) until explicitly approved.

const BRAIN_SKILLS_DIR = resolve(PROJECT_ROOT, "brain", "skills");
const SKILLS_REGISTRY = resolve(BRAIN_SKILLS_DIR, "registry.json");

let _loadedSkills = null; // Map<name, { module, schema, approved }>

async function loadBrainSkills() {
  if (_loadedSkills) return _loadedSkills;
  _loadedSkills = new Map();

  try {
    if (!existsSync(SKILLS_REGISTRY)) return _loadedSkills;
    const registry = JSON.parse(readFileSync(SKILLS_REGISTRY, "utf-8"));

    for (const skill of registry.skills || []) {
      try {
        const modulePath = resolve(BRAIN_SKILLS_DIR, skill.name, "index.mjs");
        if (!existsSync(modulePath)) continue;

        const mod = await import(modulePath);
        _loadedSkills.set(skill.name, {
          module: mod,
          schema: {
            name: skill.name,
            description: mod.description || skill.description || "",
            parameters: mod.parameters || {},
          },
          approved: skill.approved || false,
        });
      } catch (err) {
        console.warn(`[tools] Failed to load skill ${skill.name}:`, err.message);
      }
    }

    if (_loadedSkills.size > 0) {
      console.log(`[tools] Loaded ${_loadedSkills.size} brain skills`);
    }
  } catch (err) {
    console.warn(`[tools] Skills registry load failed:`, err.message);
  }

  return _loadedSkills;
}

function getBrainSkillSchemaText() {
  if (!_loadedSkills || _loadedSkills.size === 0) return "";

  const schemas = [];
  for (const [name, skill] of _loadedSkills) {
    const params = Object.entries(skill.schema.parameters);
    const paramText = params.length > 0
      ? params.map(([n, def]) => `  - ${n}: ${def.type || "any"} — ${def.description || ""}`).join("\n")
      : "(no parameters)";
    const tag = skill.approved ? "" : " [sandboxed]";
    schemas.push(`### ${name}${tag}\n${skill.schema.description}\nParameters:\n${paramText}`);
  }

  return `## Brain Skills (learned)\n\n${schemas.join("\n\n")}`;
}

async function isBrainSkill(name) {
  const skills = await loadBrainSkills();
  return skills.has(name);
}

async function executeBrainSkill(name, args) {
  const skills = await loadBrainSkills();
  const skill = skills.get(name);
  if (!skill) return { ok: false, result: `Unknown brain skill: ${name}` };

  if (!skill.approved) {
    return { ok: false, result: `Skill "${name}" is sandboxed (read-only). Approval required via Telegram.` };
  }

  try {
    const result = await skill.module.execute(args);
    return { ok: true, result: typeof result === "string" ? result : JSON.stringify(result) };
  } catch (err) {
    return { ok: false, result: `Skill error: ${err.message}` };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getToolDefinitions() {
  return TOOL_SCHEMAS;
}

export function getToolSchemaText() {
  const coreText = TOOL_SCHEMAS.map(tool => {
    const params = Object.entries(tool.parameters);
    let paramText = "(no parameters)";
    if (params.length > 0) {
      paramText = params.map(([name, def]) => {
        const req = def.required ? " (required)" : "";
        return `  - ${name}: ${def.type}${req} — ${def.description}`;
      }).join("\n");
    }
    return `### ${tool.name}\n${tool.description}\nParameters:\n${paramText}`;
  }).join("\n\n");

  let fullText = coreText;

  // Append daemon tools if available (cached from last connect)
  if (_daemonSchemaText) {
    fullText += "\n\n## Computer Tools (via familiar-daemon)\n\n" + _daemonSchemaText;
  }

  // Append external MCP server tools (Jira, Slack, etc.)
  const mcpText = getMcpSchemaText();
  if (mcpText) {
    fullText += "\n\n" + mcpText;
  }

  // Append brain skills (learned capabilities)
  const skillText = getBrainSkillSchemaText();
  if (skillText) {
    fullText += "\n\n" + skillText;
  }

  return fullText;
}

/** Pre-warm the daemon connection. Call at startup if desired. */
export async function warmDaemon() {
  await getDaemonClient();
}

export async function executeTool(name, args, context = {}) {
  const start = Date.now();

  let result;
  switch (name) {
    case "bash":
      result = await executeBash(args, context);
      break;
    case "read_file":
      result = executeReadFile(args);
      break;
    case "write_file":
      result = executeWriteFile(args);
      break;
    case "edit_file":
      result = executeEditFile(args);
      break;
    case "glob":
      result = await executeGlob(args, context);
      break;
    case "grep":
      result = executeGrep(args, context);
      break;
    case "memory_search":
      result = await executeMemorySearch(args);
      break;
    case "memory_store":
      result = await executeMemoryStore(args);
      break;
    case "memory_recent":
      result = await executeMemoryRecent(args);
      break;
    case "list_tools":
      result = executeListTools();
      break;
    default:
      // Check if it's a daemon tool (screenshots, windows, input, etc.)
      if (await isDaemonTool(name)) {
        result = await executeDaemonTool(name, args);
      }
      // Check if it's an external MCP tool (Jira, Slack, Figma, etc.)
      else if (await isMcpTool(name)) {
        result = await executeMcpTool(name, args);
      }
      // Check if it's a brain skill (learned capability)
      else if (await isBrainSkill(name)) {
        result = await executeBrainSkill(name, args);
      } else {
        result = { ok: false, result: `Unknown tool: ${name}` };
      }
  }

  return { ...result, durationMs: Date.now() - start };
}
