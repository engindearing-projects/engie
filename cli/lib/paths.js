// Single source of truth for all Familiar path resolution.
// Every module that needs a path imports from here — no hardcoded paths anywhere else.

import { resolve, join } from "path";
import { existsSync, mkdirSync } from "fs";

const HOME = process.env.HOME || "/tmp";

/** Root Familiar directory — $FAMILIAR_HOME or legacy fallbacks or ~/.familiar/ */
export function familiarHome() {
  return process.env.FAMILIAR_HOME || process.env.COZYTERM_HOME || process.env.ENGIE_HOME || resolve(HOME, ".familiar");
}

/** @deprecated Use familiarHome() */
export const cozyHome = familiarHome;
/** @deprecated Use familiarHome() */
export const engieHome = familiarHome;

/** Config dir (inside cozy home) */
export function configDir() {
  return join(familiarHome(), "config");
}

/** Workspace dir — skills, tools, persistent data */
export function workspaceDir() {
  return join(familiarHome(), "workspace");
}

/** Memory dir — structured memory, SQLite DB */
export function memoryDir() {
  return join(familiarHome(), "memory");
}

/** Cron dir — scheduled jobs */
export function cronDir() {
  return join(familiarHome(), "cron");
}

/** Logs dir — service output, archived logs */
export function logsDir() {
  return join(familiarHome(), "logs");
}

/** Profile dir — user.json, preferences.json, patterns.json */
export function profileDir() {
  return join(familiarHome(), "profile");
}

/** All managed directories */
export function allDirs() {
  return [
    familiarHome(),
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
  const primary = join(configDir(), "familiar.json");
  if (existsSync(primary)) return primary;
  // Legacy fallback
  const legacy = join(configDir(), "cozyterm.json");
  if (existsSync(legacy)) return legacy;
  return primary;
}


/** Env file path */
export function envFilePath() {
  return join(configDir(), ".env");
}

/** MCP tools config path */
export function mcpToolsPath() {
  return join(configDir(), "mcp-tools.json");
}

/** Memory SQLite database path */
export function memoryDbPath() {
  const primary = join(memoryDir(), "familiar.db");
  if (existsSync(primary)) return primary;
  const cozyDb = join(memoryDir(), "cozyterm.db");
  if (existsSync(cozyDb)) return cozyDb;
  const legacyDb = join(memoryDir(), "engie.db");
  if (existsSync(legacyDb)) return legacyDb;
  return primary;
}

/** Init state path (for setup wizard resume) */
export function initStatePath() {
  return join(familiarHome(), ".init-state.json");
}

/**
 * Resolve the gateway config file — checks multiple locations.
 * Priority: $FAMILIAR_CONFIG > $COZYTERM_CONFIG > ~/.familiar/config/ > legacy paths
 */
export function findConfig() {
  const familiarPath = process.env.FAMILIAR_CONFIG;
  if (familiarPath && existsSync(familiarPath)) return familiarPath;

  const cozyPath = process.env.COZYTERM_CONFIG;
  if (cozyPath && existsSync(cozyPath)) return cozyPath;

  const envPath = process.env.ENGIE_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(configDir(), "familiar.json"),
    join(configDir(), "cozyterm.json"),
    resolve(HOME, ".cozyterm/config/cozyterm.json"),
    resolve(HOME, "engie/config/cozyterm.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}


/** Return all paths as a plain object (useful for config generation / debugging) */
export function configPaths() {
  return {
    cozyHome: familiarHome(),
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
