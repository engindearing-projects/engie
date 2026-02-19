// Single source of truth for all Engie path resolution.
// Every module that needs a path imports from here — no hardcoded paths anywhere else.

import { resolve, join } from "path";
import { existsSync, mkdirSync, symlinkSync, readlinkSync } from "fs";

const HOME = process.env.HOME || "/tmp";

/** Root Engie directory — $ENGIE_HOME or ~/.engie/ */
export function engieHome() {
  return process.env.ENGIE_HOME || resolve(HOME, ".engie");
}

/** OpenClaw config dir (inside engie home) */
export function configDir() {
  return join(engieHome(), "config");
}

/** Workspace dir — skills, tools, persistent data */
export function workspaceDir() {
  return join(engieHome(), "workspace");
}

/** Memory dir — structured memory, SQLite DB */
export function memoryDir() {
  return join(engieHome(), "memory");
}

/** Cron dir — scheduled jobs */
export function cronDir() {
  return join(engieHome(), "cron");
}

/** Logs dir — service output, archived logs */
export function logsDir() {
  return join(engieHome(), "logs");
}

/** Profile dir — user.json, preferences.json, patterns.json */
export function profileDir() {
  return join(engieHome(), "profile");
}

/** All managed directories */
export function allDirs() {
  return [
    engieHome(),
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

/** OpenClaw config file path */
export function openclawConfigPath() {
  return join(configDir(), "openclaw.json");
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
  return join(memoryDir(), "engie.db");
}

/** Init state path (for setup wizard resume) */
export function initStatePath() {
  return join(engieHome(), ".init-state.json");
}

/**
 * Resolve the OpenClaw config file — checks multiple locations.
 * Priority: $ENGIE_CONFIG > ~/.engie/config/ > ~/.openclaw/ > legacy ~/engie/config/
 */
export function findConfig() {
  const envPath = process.env.ENGIE_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    openclawConfigPath(),
    resolve(HOME, ".openclaw/openclaw.json"),
    resolve(HOME, "engie/config/openclaw.json"),
    "/etc/engie/openclaw.json",
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Ensure ~/.openclaw symlink points to ~/.engie/config for OpenClaw compatibility.
 * Only creates the symlink if it doesn't exist or points elsewhere.
 */
export function ensureOpenclawSymlink() {
  const oclawDir = resolve(HOME, ".openclaw");
  const target = configDir();

  if (existsSync(oclawDir)) {
    try {
      const current = readlinkSync(oclawDir);
      if (resolve(current) === resolve(target)) return; // already correct
    } catch {
      // exists but not a symlink — leave it alone
      return;
    }
  }

  try {
    symlinkSync(target, oclawDir);
  } catch {
    // non-fatal — user may need to fix manually
  }
}

/** Return all paths as a plain object (useful for config generation / debugging) */
export function configPaths() {
  return {
    engieHome: engieHome(),
    config: configDir(),
    workspace: workspaceDir(),
    memory: memoryDir(),
    cron: cronDir(),
    logs: logsDir(),
    profile: profileDir(),
    openclawConfig: openclawConfigPath(),
    envFile: envFilePath(),
    mcpTools: mcpToolsPath(),
    memoryDb: memoryDbPath(),
  };
}
