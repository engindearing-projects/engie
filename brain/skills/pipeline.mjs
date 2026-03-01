#!/usr/bin/env bun

// Skill Installation Pipeline
// Discovers, validates, installs, activates, and uninstalls skills from templates.
//
// Usage:
//   bun brain/skills/pipeline.mjs list                 — list all installed skills
//   bun brain/skills/pipeline.mjs templates             — list available templates
//   bun brain/skills/pipeline.mjs install <name>        — install a skill from template
//   bun brain/skills/pipeline.mjs activate <name>       — mark skill as active (approved)
//   bun brain/skills/pipeline.mjs deactivate <name>     — mark skill as sandboxed (unapproved)
//   bun brain/skills/pipeline.mjs uninstall <name>      — remove skill and deregister
//   bun brain/skills/pipeline.mjs validate <name>       — validate a template without installing
//   bun brain/skills/pipeline.mjs install-all           — install all available templates

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const SKILLS_DIR = resolve(import.meta.dir);
const TEMPLATES_DIR = resolve(SKILLS_DIR, "templates");
const REGISTRY_PATH = resolve(SKILLS_DIR, "registry.json");

// ── Registry Helpers ────────────────────────────────────────────────────────

function loadRegistry() {
  try {
    if (existsSync(REGISTRY_PATH)) {
      return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    }
  } catch { /* corrupt registry, start fresh */ }
  return { skills: [], lastUpdated: null };
}

function saveRegistry(registry) {
  registry.lastUpdated = new Date().toISOString();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// ── Template Discovery ──────────────────────────────────────────────────────

/**
 * Scan the templates directory and return all valid template manifests.
 * Each template is a JSON file with at minimum: name, description, source.code
 */
export function discoverTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];

  const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".json"));
  const templates = [];

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(TEMPLATES_DIR, file), "utf-8");
      const template = JSON.parse(raw);
      template._file = file;
      templates.push(template);
    } catch (err) {
      console.warn(`[pipeline] Skipping ${file}: ${err.message}`);
    }
  }

  return templates;
}

// ── Template Validation ─────────────────────────────────────────────────────

/**
 * Validate a template manifest. Returns { valid, errors }.
 */
export function validateTemplate(template) {
  const errors = [];

  if (!template.name || typeof template.name !== "string") {
    errors.push("Missing or invalid 'name' (must be a non-empty string)");
  } else if (!/^[a-z][a-z0-9_]*$/.test(template.name)) {
    errors.push(`Invalid name '${template.name}' — must be lowercase alphanumeric with underscores, starting with a letter`);
  }

  if (!template.description || typeof template.description !== "string") {
    errors.push("Missing or invalid 'description'");
  }

  if (!template.source?.code || typeof template.source.code !== "string") {
    errors.push("Missing 'source.code' — template must include the skill source code");
  }

  if (template.source?.code) {
    const code = template.source.code;
    if (!code.includes("export const name")) {
      errors.push("Source code missing 'export const name'");
    }
    if (!code.includes("export async function execute")) {
      errors.push("Source code missing 'export async function execute'");
    }

    // Check for potentially unsafe operations
    const unsafePatterns = [
      { pattern: /process\.exit/g, reason: "process.exit calls" },
      { pattern: /child_process.*spawn/g, reason: "spawn (use execSync instead)" },
      { pattern: /eval\s*\(/g, reason: "eval() calls" },
      { pattern: /Function\s*\(/g, reason: "Function() constructor" },
    ];

    for (const { pattern, reason } of unsafePatterns) {
      if (pattern.test(code)) {
        errors.push(`Source code contains unsafe pattern: ${reason}`);
      }
    }
  }

  // Validate dependencies — for now, only allow empty deps (no npm)
  if (template.dependencies && template.dependencies.length > 0) {
    errors.push("External dependencies are not supported — skills must use only Node.js built-ins");
  }

  // Validate sandbox config if present
  if (template.sandbox) {
    const allowed = ["allowNetwork", "allowFileWrite", "allowShell", "maxExecutionMs"];
    for (const key of Object.keys(template.sandbox)) {
      if (!allowed.includes(key)) {
        errors.push(`Unknown sandbox option: '${key}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Skill Installation ──────────────────────────────────────────────────────

/**
 * Install a skill from a template. Writes the module to the skills directory
 * and registers it in registry.json. Installed as sandboxed (unapproved) by default.
 *
 * Returns { ok, message, skill? }
 */
export function installSkill(template) {
  // Validate first
  const validation = validateTemplate(template);
  if (!validation.valid) {
    return { ok: false, message: `Validation failed:\n  - ${validation.errors.join("\n  - ")}` };
  }

  const registry = loadRegistry();
  const existing = registry.skills.find(s => s.name === template.name);
  if (existing) {
    return { ok: false, message: `Skill '${template.name}' is already installed (installed at ${existing.installedAt})` };
  }

  // Create skill directory and write the module
  const skillDir = resolve(SKILLS_DIR, template.name);
  mkdirSync(skillDir, { recursive: true });

  const entryPoint = template.entryPoint || "index.mjs";
  writeFileSync(resolve(skillDir, entryPoint), template.source.code);

  // Write a local manifest for reference
  const manifest = {
    name: template.name,
    version: template.version || "1.0.0",
    description: template.description,
    author: template.author || "unknown",
    parameters: template.parameters || {},
    sandbox: template.sandbox || {},
    tags: template.tags || [],
    installedAt: new Date().toISOString(),
    installedFrom: template._file || "api",
  };
  writeFileSync(resolve(skillDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Register in registry.json
  registry.skills.push({
    name: template.name,
    description: template.description,
    parameters: template.parameters || {},
    approved: false,
    installedAt: manifest.installedAt,
    version: manifest.version,
    tags: manifest.tags,
  });
  saveRegistry(registry);

  return {
    ok: true,
    message: `Installed skill '${template.name}' (sandboxed — run 'activate ${template.name}' to approve)`,
    skill: manifest,
  };
}

// ── Skill Activation ────────────────────────────────────────────────────────

/**
 * Mark a skill as active (approved), making it available to the tool loop.
 */
export function activateSkill(name) {
  const registry = loadRegistry();
  const skill = registry.skills.find(s => s.name === name);

  if (!skill) {
    return { ok: false, message: `Skill '${name}' is not installed` };
  }

  if (skill.approved) {
    return { ok: false, message: `Skill '${name}' is already active` };
  }

  skill.approved = true;
  skill.activatedAt = new Date().toISOString();
  saveRegistry(registry);

  return { ok: true, message: `Activated skill '${name}' — now available in the tool loop` };
}

/**
 * Mark a skill as sandboxed (unapproved).
 */
export function deactivateSkill(name) {
  const registry = loadRegistry();
  const skill = registry.skills.find(s => s.name === name);

  if (!skill) {
    return { ok: false, message: `Skill '${name}' is not installed` };
  }

  if (!skill.approved) {
    return { ok: false, message: `Skill '${name}' is already sandboxed` };
  }

  skill.approved = false;
  delete skill.activatedAt;
  saveRegistry(registry);

  return { ok: true, message: `Deactivated skill '${name}' — now sandboxed` };
}

// ── Skill Uninstallation ────────────────────────────────────────────────────

/**
 * Remove a skill: delete its directory and deregister from registry.json.
 */
export function uninstallSkill(name) {
  const registry = loadRegistry();
  const idx = registry.skills.findIndex(s => s.name === name);

  if (idx === -1) {
    return { ok: false, message: `Skill '${name}' is not installed` };
  }

  // Remove from registry
  registry.skills.splice(idx, 1);
  saveRegistry(registry);

  // Remove the skill directory
  const skillDir = resolve(SKILLS_DIR, name);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
  }

  return { ok: true, message: `Uninstalled skill '${name}'` };
}

// ── List Installed ──────────────────────────────────────────────────────────

/**
 * List all installed skills with their status.
 */
export function listInstalled() {
  const registry = loadRegistry();
  return registry.skills.map(s => ({
    name: s.name,
    description: s.description,
    status: s.approved ? "active" : "sandboxed",
    version: s.version || "1.0.0",
    installedAt: s.installedAt,
    activatedAt: s.activatedAt || null,
    tags: s.tags || [],
  }));
}

// ── Find Template by Name ───────────────────────────────────────────────────

/**
 * Find a template by skill name from the templates directory.
 */
export function findTemplate(name) {
  const templates = discoverTemplates();
  return templates.find(t => t.name === name) || null;
}

// ── Install from Template by Name ───────────────────────────────────────────

/**
 * Convenience: find a template by name and install it.
 */
export function installFromTemplate(name) {
  const template = findTemplate(name);
  if (!template) {
    const available = discoverTemplates().map(t => t.name);
    return {
      ok: false,
      message: `Template '${name}' not found. Available: ${available.join(", ") || "(none)"}`,
    };
  }
  return installSkill(template);
}

// ── Install All Templates ───────────────────────────────────────────────────

/**
 * Install all available templates that are not already installed.
 */
export function installAllTemplates() {
  const templates = discoverTemplates();
  const results = [];

  for (const template of templates) {
    const result = installSkill(template);
    results.push({ name: template.name, ...result });
  }

  return results;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Skill Installation Pipeline

Usage:
  bun brain/skills/pipeline.mjs <command> [args]

Commands:
  list                  List all installed skills
  templates             List available templates
  install <name>        Install a skill from a template
  install-all           Install all available templates
  activate <name>       Approve a skill for use in the tool loop
  deactivate <name>     Sandbox a skill (disable without removing)
  uninstall <name>      Remove a skill entirely
  validate <name>       Validate a template without installing
`.trim());
}

async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];
  const target = args[1];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  switch (command) {
    case "list": {
      const skills = listInstalled();
      if (skills.length === 0) {
        console.log("No skills installed. Run 'templates' to see what's available.");
        return;
      }
      console.log(`Installed skills (${skills.length}):\n`);
      for (const s of skills) {
        const status = s.status === "active" ? "[active]" : "[sandboxed]";
        const tags = s.tags.length > 0 ? ` (${s.tags.join(", ")})` : "";
        console.log(`  ${status} ${s.name} v${s.version} — ${s.description}${tags}`);
        console.log(`           installed: ${s.installedAt}${s.activatedAt ? `, activated: ${s.activatedAt}` : ""}`);
      }
      break;
    }

    case "templates": {
      const templates = discoverTemplates();
      if (templates.length === 0) {
        console.log("No templates found in brain/skills/templates/");
        return;
      }
      const registry = loadRegistry();
      const installed = new Set(registry.skills.map(s => s.name));

      console.log(`Available templates (${templates.length}):\n`);
      for (const t of templates) {
        const tag = installed.has(t.name) ? " [installed]" : "";
        const tags = t.tags?.length > 0 ? ` (${t.tags.join(", ")})` : "";
        console.log(`  ${t.name} v${t.version || "1.0.0"}${tag} — ${t.description}${tags}`);
      }
      break;
    }

    case "install": {
      if (!target) {
        console.error("Usage: install <name>");
        process.exit(1);
      }
      const result = installFromTemplate(target);
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }

    case "install-all": {
      const results = installAllTemplates();
      for (const r of results) {
        const icon = r.ok ? "+" : "-";
        console.log(`  [${icon}] ${r.name}: ${r.message}`);
      }
      const installed = results.filter(r => r.ok).length;
      console.log(`\n${installed}/${results.length} templates installed.`);
      break;
    }

    case "activate": {
      if (!target) {
        console.error("Usage: activate <name>");
        process.exit(1);
      }
      const result = activateSkill(target);
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }

    case "deactivate": {
      if (!target) {
        console.error("Usage: deactivate <name>");
        process.exit(1);
      }
      const result = deactivateSkill(target);
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }

    case "uninstall": {
      if (!target) {
        console.error("Usage: uninstall <name>");
        process.exit(1);
      }
      const result = uninstallSkill(target);
      console.log(result.message);
      if (!result.ok) process.exit(1);
      break;
    }

    case "validate": {
      if (!target) {
        console.error("Usage: validate <name>");
        process.exit(1);
      }
      const template = findTemplate(target);
      if (!template) {
        console.error(`Template '${target}' not found`);
        process.exit(1);
      }
      const result = validateTemplate(template);
      if (result.valid) {
        console.log(`Template '${target}' is valid.`);
      } else {
        console.log(`Template '${target}' has errors:`);
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// Run CLI if executed directly
const isMain = process.argv[1]?.endsWith("pipeline.mjs");
if (isMain) {
  cli().catch(err => {
    console.error(`[pipeline] Fatal: ${err.message}`);
    process.exit(1);
  });
}
