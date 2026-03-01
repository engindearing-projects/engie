// Hand Schema — defines the structure of a HAND.json manifest
//
// Inspired by OpenFang's autonomous "Hands" system.
// A Hand is an autonomous capability package that runs on a schedule,
// executes multi-phase playbooks, tracks metrics, and manages its own lifecycle.

/**
 * HAND.json schema:
 *
 * {
 *   "name": "forge-miner",                    // unique identifier
 *   "version": "1.0.0",                       // semver
 *   "description": "Mines training data from GitHub PRs",
 *   "author": "familiar",
 *
 *   "schedule": {                              // when to run
 *     "cron": "0 4 * * *",                    // cron expression
 *     "tz": "America/Los_Angeles",            // timezone
 *     "runOnStart": false,                    // run immediately on activation
 *     "maxDuration": 7200                     // max seconds per run
 *   },
 *
 *   "tools": ["bash", "read_file", "grep"],   // tools this hand can use
 *
 *   "phases": [                               // ordered execution phases
 *     {
 *       "name": "prepare",
 *       "prompt": "Check forge DB stats...",
 *       "mode": "chat",                       // "chat" (default) | "agentic"
 *       "timeout": 60,                        // phase timeout in seconds
 *       "onFail": "skip"                      // "skip" | "abort" | "retry"
 *     },
 *     // mode "agentic" — runs the full tool loop (bash, read_file, write_file,
 *     // edit_file, grep, glob, etc). The model can read files, write code,
 *     // run commands, and iterate until done or timeout.
 *     {
 *       "name": "mine",
 *       "prompt": "Run ground-truth mining...",
 *       "timeout": 3600,
 *       "onFail": "abort"
 *     },
 *     {
 *       "name": "report",
 *       "prompt": "Send results via Telegram...",
 *       "timeout": 30,
 *       "onFail": "skip"
 *     }
 *   ],
 *
 *   "env": {                                  // environment variables needed
 *     "GEMINI_API_KEY": { "required": true },
 *     "GITHUB_TOKEN": { "required": false }
 *   },
 *
 *   "metrics": {                              // what to track
 *     "pairs_collected": { "type": "counter", "description": "Training pairs mined" },
 *     "run_duration": { "type": "gauge", "description": "Seconds per run" },
 *     "errors": { "type": "counter", "description": "Errors encountered" }
 *   },
 *
 *   "guardrails": {                           // safety constraints
 *     "readOnly": false,                      // can this hand write files?
 *     "networkAccess": true,                  // can it make HTTP requests?
 *     "maxConcurrent": 1,                     // max concurrent runs
 *     "approvalRequired": false               // needs human approval before each run?
 *   },
 *
 *   "state": {                                // persisted between runs
 *     "lastCheckpoint": null,                 // where we left off
 *     "custom": {}                            // hand-specific state
 *   }
 * }
 */

const VALID_ON_FAIL = new Set(["skip", "abort", "retry"]);
const VALID_METRIC_TYPES = new Set(["counter", "gauge", "histogram"]);

/**
 * Validate a HAND.json manifest.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("'name' is required and must be a string");
  } else if (!/^[a-z0-9_-]+$/.test(manifest.name)) {
    errors.push("'name' must be lowercase alphanumeric with hyphens/underscores");
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push("'description' is required");
  }

  // Schedule
  if (manifest.schedule) {
    if (!manifest.schedule.cron || typeof manifest.schedule.cron !== "string") {
      errors.push("'schedule.cron' is required when schedule is defined");
    }
    if (manifest.schedule.maxDuration && typeof manifest.schedule.maxDuration !== "number") {
      errors.push("'schedule.maxDuration' must be a number (seconds)");
    }
  }

  // Phases
  if (!Array.isArray(manifest.phases) || manifest.phases.length === 0) {
    errors.push("'phases' must be a non-empty array");
  } else {
    for (let i = 0; i < manifest.phases.length; i++) {
      const phase = manifest.phases[i];
      if (!phase.name) errors.push(`phases[${i}]: 'name' is required`);
      if (!phase.prompt) errors.push(`phases[${i}]: 'prompt' is required`);
      if (phase.onFail && !VALID_ON_FAIL.has(phase.onFail)) {
        errors.push(`phases[${i}]: 'onFail' must be skip|abort|retry`);
      }
    }
  }

  // Tools
  if (manifest.tools && !Array.isArray(manifest.tools)) {
    errors.push("'tools' must be an array of strings");
  }

  // Metrics
  if (manifest.metrics) {
    for (const [key, def] of Object.entries(manifest.metrics)) {
      if (!def.type || !VALID_METRIC_TYPES.has(def.type)) {
        errors.push(`metrics.${key}: 'type' must be counter|gauge|histogram`);
      }
    }
  }

  // Guardrails
  if (manifest.guardrails) {
    if (manifest.guardrails.maxConcurrent != null && typeof manifest.guardrails.maxConcurrent !== "number") {
      errors.push("'guardrails.maxConcurrent' must be a number");
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Create a minimal default manifest for a hand name.
 */
export function defaultManifest(name) {
  return {
    name,
    version: "1.0.0",
    description: "",
    author: "familiar",
    schedule: null,
    tools: [],
    phases: [],
    env: {},
    metrics: {},
    guardrails: {
      readOnly: true,
      networkAccess: false,
      maxConcurrent: 1,
      approvalRequired: false,
    },
    state: {
      lastCheckpoint: null,
      custom: {},
    },
  };
}
