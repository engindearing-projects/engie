// Single source of truth for all CozyTerm path resolution.
// Every module that needs a path imports from here — no hardcoded paths anywhere else.

import { resolve, join } from "path";
import { existsSync, mkdirSync } from "fs";

const HOME = process.env.HOME || "/tmp";

/** Root CozyTerm directory — $COZYTERM_HOME or $ENGIE_HOME (fallback) or ~/.cozyterm/ */
export function cozyHome() {
  return process.env.COZYTERM_HOME || process.env.ENGIE_HOME || resolve(HOME, ".cozyterm");
}

/** @deprecated Use cozyHome() — kept for backward compatibility */
export const engieHome = cozyHome;

/** Config dir (inside cozy home) */
export function configDir() {
  return join(cozyHome(), "config");
}

/** Workspace dir — skills, tools, persistent data */
export function workspaceDir() {
  return join(cozyHome(), "workspace");
}

/** Memory dir — structured memory, SQLite DB */
export function memoryDir() {
  return join(cozyHome(), "memory");
}

/** Cron dir — scheduled jobs */
export function cronDir() {
  return join(cozyHome(), "cron");
}

/** Logs dir — service output, archived logs */
export function logsDir() {
  return join(cozyHome(), "logs");
}

/** Profile dir — user.json, preferences.json, patterns.json */
export function profileDir() {
  return join(cozyHome(), "profile");
}

/** All managed directories */
export function allDirs() {
  return [
    cozyHome(),
    configDir(),
    workspaceDir(),
    memoryDir(),
    cronDir(),
    logsDir(),
    profileDir(),
  ];
}

/** Ensure all directories exist */
export function ensureDirs() {
  for (const dir of allDirs()) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/** Gateway config file path */
export function configPath() {
  return join(configDir(), "cozyterm.json");
}


/** Env file path */
export function envFilePath() {
  return join(configDir(), ".env");
}

/** MCP tools config path */
export function mcpToolsPath() {
  return join(configDir(), "mcp-tools.json");
}

/** Memory SQLite database path — checks cozyterm.db first, falls back to engie.db */
export function memoryDbPath() {
  const cozyDb = join(memoryDir(), "cozyterm.db");
  if (existsSync(cozyDb)) return cozyDb;
  const legacyDb = join(memoryDir(), "engie.db");
  if (existsSync(legacyDb)) return legacyDb;
  // Default to new name for fresh installs
  return cozyDb;
}

/** Init state path (for setup wizard resume) */
export function initStatePath() {
  return join(cozyHome(), ".init-state.json");
}

/**
 * Resolve the gateway config file — checks multiple locations.
 * Priority: $COZYTERM_CONFIG > $ENGIE_CONFIG > ~/.cozyterm/config/ > ~/.engie/config/ > legacy ~/engie/config/
 */
export function findConfig() {
  const cozyPath = process.env.COZYTERM_CONFIG;
  if (cozyPath && existsSync(cozyPath)) return cozyPath;

  const envPath = process.env.ENGIE_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(configDir(), "cozyterm.json"),
    resolve(HOME, ".engie/config/cozyterm.json"),
    resolve(HOME, "engie/config/cozyterm.json"),
    "/etc/cozyterm/cozyterm.json",
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}


/** Return all paths as a plain object (useful for config generation / debugging) */
export function configPaths() {
  return {
    cozyHome: cozyHome(),
    config: configDir(),
    workspace: workspaceDir(),
    memory: memoryDir(),
    cron: cronDir(),
    logs: logsDir(),
    profile: profileDir(),
    gatewayConfig: configPath(),
    envFile: envFilePath(),
    mcpTools: mcpToolsPath(),
    memoryDb: memoryDbPath(),
  };
}
