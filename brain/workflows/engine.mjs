#!/usr/bin/env bun

// Workflow Engine — chains hands, tasks, and conditions into dependency graphs
//
// Executes steps respecting dependencies, runs independent steps in parallel,
// supports conditional branching, data passing via shared context, and
// per-step error recovery (retry, skip, abort).
//
// Usage:
//   import { executeWorkflow } from "./engine.mjs";
//   const result = await executeWorkflow(definition, { dryRun: false });
//
// CLI:
//   bun brain/workflows/engine.mjs run <workflow.json> [--dry-run]
//   bun brain/workflows/engine.mjs validate <workflow.json>
//   bun brain/workflows/engine.mjs list

import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, basename } from "path";
import { validateWorkflow } from "./schema.mjs";

const PROJECT_DIR = resolve(import.meta.dir, "../..");
const TEMPLATES_DIR = resolve(import.meta.dir, "templates");

// ── Step Executors ──────────────────────────────────────────────────────────

/**
 * Execute a "hand" step — runs a registered hand via the runner.
 */
async function executeHandStep(step, context) {
  const { HandRegistry } = await import("../hands/registry.mjs");
  const { runHand } = await import("../hands/runner.mjs");

  const registry = new HandRegistry();
  registry.load();

  const hand = registry.get(step.hand);
  if (!hand) {
    return { ok: false, error: `Hand "${step.hand}" not found` };
  }

  // Auto-activate if inactive
  if (hand.status === "inactive") {
    registry.activate(step.hand);
  }

  const result = await runHand(registry, step.hand, {
    dryRun: context._dryRun || false,
    notify: false, // workflow sends its own notifications
  });

  return {
    ok: result.ok,
    output: result,
    error: result.ok ? null : (result.error || "Hand execution failed"),
  };
}

/**
 * Execute a "task" step — runs a shell command via Bun subprocess.
 */
async function executeTaskStep(step, context) {
  const cwd = step.cwd || PROJECT_DIR;
  const timeoutMs = (step.timeout || 300) * 1000;

  // Interpolate context variables into the command
  let command = step.command;
  for (const [key, value] of Object.entries(context)) {
    if (key.startsWith("_")) continue; // skip internal keys
    const placeholder = `\${${key}}`;
    if (command.includes(placeholder)) {
      const strVal = typeof value === "string" ? value : JSON.stringify(value);
      command = command.replaceAll(placeholder, strVal);
    }
  }

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    // Apply timeout
    const timer = setTimeout(() => proc.kill(), timeoutMs);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timer);

    if (exitCode !== 0) {
      return {
        ok: false,
        output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode },
        error: `Command exited with code ${exitCode}: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`,
      };
    }

    return {
      ok: true,
      output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Task execution failed: ${err.message}`,
    };
  }
}

/**
 * Evaluate a "condition" step — checks an expression against context.
 *
 * Supported check formats:
 *   "stepId.ok"           — truthy check on step result
 *   "stepId.ok == true"   — equality check
 *   "stepId.ok != false"  — inequality check
 *   "context.key"         — truthy check on context value
 *
 * Returns { ok: true, branch: "then" | "else" }
 */
function evaluateCondition(step, context, stepResults) {
  const check = step.check;
  let result = false;

  try {
    // Parse the check expression
    const eqMatch = check.match(/^(.+?)\s*(==|!=)\s*(.+)$/);

    if (eqMatch) {
      const [, left, op, right] = eqMatch;
      const leftVal = resolveValue(left.trim(), context, stepResults);
      const rightVal = parseRightSide(right.trim());

      if (op === "==") result = leftVal == rightVal;
      else if (op === "!=") result = leftVal != rightVal;
    } else {
      // Simple truthy check
      result = !!resolveValue(check.trim(), context, stepResults);
    }
  } catch {
    result = false;
  }

  return {
    ok: true,
    branch: result ? "then" : "else",
    output: { check, result, branch: result ? "then" : "else" },
  };
}

/**
 * Resolve a dotted path to a value from step results or context.
 * e.g. "mine-data.ok" resolves to stepResults["mine-data"].ok
 */
function resolveValue(path, context, stepResults) {
  const parts = path.split(".");
  const root = parts[0];

  // Check step results first
  if (stepResults.has(root)) {
    let val = stepResults.get(root);
    for (let i = 1; i < parts.length; i++) {
      if (val == null) return undefined;
      val = val[parts[i]];
    }
    return val;
  }

  // Then check context
  let val = context;
  for (const part of parts) {
    if (val == null) return undefined;
    val = val[part];
  }
  return val;
}

/**
 * Parse a right-side comparison value.
 */
function parseRightSide(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^\d+$/.test(raw)) return parseInt(raw);
  if (/^\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // Strip quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ── Workflow Execution ──────────────────────────────────────────────────────

/**
 * Execute a workflow definition.
 *
 * @param {object} definition - Validated workflow definition
 * @param {object} opts
 * @param {boolean} opts.dryRun - Log steps without executing
 * @param {function} opts.onStep - Callback when a step starts/completes
 * @returns {Promise<WorkflowResult>}
 */
export async function executeWorkflow(definition, opts = {}) {
  // Validate first
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return { ok: false, error: "Invalid workflow definition", details: validation.errors };
  }

  const startTime = Date.now();
  const dryRun = opts.dryRun || false;
  const onStep = opts.onStep || (() => {});
  const workflowTimeout = (definition.timeout || 7200) * 1000; // default 2 hours

  // Build dependency graph
  const steps = new Map();
  for (const step of definition.steps) {
    steps.set(step.id, { ...step, depends: step.depends || [] });
  }

  // Shared context for data passing between steps
  const context = {
    _dryRun: dryRun,
    _workflowName: definition.name,
    _startTime: new Date().toISOString(),
    ...(definition.context || {}),
  };

  // Results per step
  const stepResults = new Map();

  // Track which steps have been completed, skipped, or are pending
  const completed = new Set();
  const skipped = new Set();
  const conditionalSkips = new Set(); // steps skipped by condition branching

  let aborted = false;
  let abortError = null;

  // Workflow-level timeout
  const workflowTimer = setTimeout(() => {
    aborted = true;
    abortError = `Workflow timeout (${definition.timeout || 7200}s)`;
  }, workflowTimeout);

  console.log(`[workflow:${definition.name}] Starting (${definition.steps.length} steps, dry-run: ${dryRun})`);

  try {
    while (!aborted) {
      // Find steps that are ready to run: all dependencies completed, not yet run
      const ready = [];
      let allDone = true;

      for (const [id, step] of steps) {
        if (completed.has(id) || skipped.has(id) || conditionalSkips.has(id)) continue;
        allDone = false;

        // Check if all dependencies are satisfied
        const depsOk = step.depends.every(dep =>
          completed.has(dep) || skipped.has(dep) || conditionalSkips.has(dep)
        );
        if (depsOk) {
          ready.push(step);
        }
      }

      if (allDone) break;
      if (ready.length === 0) {
        // Deadlock — shouldn't happen if validation passes, but handle gracefully
        aborted = true;
        abortError = "Deadlock: no steps ready but workflow not complete";
        break;
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(
        ready.map(step => executeStep(step, context, stepResults, dryRun, onStep))
      );

      // Process results
      for (let i = 0; i < ready.length; i++) {
        const step = ready[i];
        const settled = results[i];

        let stepResult;
        if (settled.status === "fulfilled") {
          stepResult = settled.value;
        } else {
          stepResult = {
            ok: false,
            error: settled.reason?.message || "Unknown error",
            duration: 0,
          };
        }

        stepResults.set(step.id, stepResult);

        // Handle condition branching
        if (step.type === "condition" && stepResult.ok) {
          const branch = stepResult.branch;
          const activeTarget = step[branch]; // "then" or "else" step id
          const inactiveTarget = branch === "then" ? step.else : step.then;

          if (inactiveTarget) {
            // Mark the inactive branch step (and its exclusive dependents) as conditionally skipped
            conditionalSkips.add(inactiveTarget);
            console.log(`[workflow:${definition.name}]   Condition "${step.id}" → ${branch}, skipping "${inactiveTarget}"`);
          }

          // The active target will proceed through normal dependency resolution
          completed.add(step.id);

          // Put branch result into context
          context[step.id] = { branch, check: step.check, result: stepResult.output?.result };
          continue;
        }

        if (stepResult.ok || step.type === "condition") {
          completed.add(step.id);

          // Store output in context for downstream steps
          if (stepResult.output != null) {
            context[step.id] = stepResult.output;
          }

          onStep({ id: step.id, status: "completed", duration: stepResult.duration });
        } else {
          // Handle error
          const onError = step.onError || "abort";
          console.log(`[workflow:${definition.name}]   Step "${step.id}" failed: ${stepResult.error} (onError: ${onError})`);

          if (onError === "abort") {
            aborted = true;
            abortError = `Step "${step.id}" failed: ${stepResult.error}`;
            onStep({ id: step.id, status: "aborted", error: stepResult.error });
            break;
          } else if (onError === "retry") {
            const retries = step.retries || 1;
            let retried = false;
            for (let attempt = 0; attempt < retries; attempt++) {
              console.log(`[workflow:${definition.name}]   Retrying "${step.id}" (attempt ${attempt + 1}/${retries})`);
              const retryResult = await executeStep(step, context, stepResults, dryRun, onStep);
              if (retryResult.ok) {
                stepResults.set(step.id, retryResult);
                completed.add(step.id);
                if (retryResult.output != null) {
                  context[step.id] = retryResult.output;
                }
                retried = true;
                onStep({ id: step.id, status: "completed", duration: retryResult.duration, retryAttempt: attempt + 1 });
                break;
              }
            }
            if (!retried) {
              // All retries exhausted — treat as skip
              skipped.add(step.id);
              onStep({ id: step.id, status: "skipped", error: stepResult.error, retriesExhausted: true });
            }
          } else {
            // skip
            skipped.add(step.id);
            onStep({ id: step.id, status: "skipped", error: stepResult.error });
          }
        }
      }
    }
  } finally {
    clearTimeout(workflowTimer);
  }

  const duration = Date.now() - startTime;

  const summary = {
    ok: !aborted,
    workflow: definition.name,
    duration,
    steps: definition.steps.map(s => {
      const result = stepResults.get(s.id);
      let status = "pending";
      if (completed.has(s.id)) status = "completed";
      else if (skipped.has(s.id)) status = "skipped";
      else if (conditionalSkips.has(s.id)) status = "condition-skipped";
      else if (aborted) status = "not-reached";
      return {
        id: s.id,
        type: s.type,
        status,
        duration: result?.duration || 0,
        error: result?.error || null,
      };
    }),
    context: stripInternalKeys(context),
    error: abortError,
  };

  const completedCount = completed.size;
  const skippedCount = skipped.size + conditionalSkips.size;
  console.log(
    `[workflow:${definition.name}] ${aborted ? "Aborted" : "Complete"} in ${(duration / 1000).toFixed(1)}s ` +
    `(${completedCount} completed, ${skippedCount} skipped)`
  );

  return summary;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Execute a single step with timeout.
 */
async function executeStep(step, context, stepResults, dryRun, onStep) {
  const startTime = Date.now();
  const timeoutMs = (step.timeout || 300) * 1000;

  console.log(`[workflow:${context._workflowName}] Step: ${step.id} (${step.type})`);
  onStep({ id: step.id, status: "started", type: step.type });

  if (dryRun) {
    const desc = step.type === "hand" ? `run hand "${step.hand}"`
      : step.type === "task" ? `execute: ${step.command?.slice(0, 80)}`
      : `evaluate: ${step.check}`;
    console.log(`[workflow:${context._workflowName}]   (dry run) Would ${desc}`);
    return { ok: true, output: { dryRun: true }, duration: 0, branch: step.type === "condition" ? "then" : undefined };
  }

  // Wrap execution with timeout
  const execPromise = (async () => {
    switch (step.type) {
      case "hand":
        return executeHandStep(step, context);

      case "task":
        return executeTaskStep(step, context);

      case "condition":
        return evaluateCondition(step, context, stepResults);

      default:
        return { ok: false, error: `Unknown step type: ${step.type}` };
    }
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Step "${step.id}" timed out after ${step.timeout || 300}s`)), timeoutMs)
  );

  try {
    const result = await Promise.race([execPromise, timeoutPromise]);
    result.duration = Date.now() - startTime;

    if (result.ok) {
      const extra = result.duration > 1000 ? ` (${(result.duration / 1000).toFixed(1)}s)` : "";
      console.log(`[workflow:${context._workflowName}]   Step "${step.id}" completed${extra}`);
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Remove internal context keys (prefixed with _) for the final summary.
 */
function stripInternalKeys(context) {
  const clean = {};
  for (const [key, value] of Object.entries(context)) {
    if (!key.startsWith("_")) {
      clean[key] = value;
    }
  }
  return clean;
}

// ── Workflow Loader ─────────────────────────────────────────────────────────

/**
 * Load a workflow definition from a JSON file.
 * Resolves the path against the templates directory if not absolute.
 */
export function loadWorkflow(filePath) {
  // Resolve relative to templates dir, or CWD, or absolute
  let resolved = filePath;
  if (!resolve(filePath).startsWith("/")) {
    resolved = resolve(process.cwd(), filePath);
  }

  // Try templates directory if not found
  if (!existsSync(resolved)) {
    const templatesPath = resolve(TEMPLATES_DIR, basename(filePath));
    if (existsSync(templatesPath)) {
      resolved = templatesPath;
    }
  }

  if (!existsSync(resolved)) {
    return { ok: false, error: `Workflow file not found: ${filePath}` };
  }

  try {
    const content = readFileSync(resolved, "utf-8");
    const definition = JSON.parse(content);
    return { ok: true, definition, path: resolved };
  } catch (err) {
    return { ok: false, error: `Failed to parse workflow file: ${err.message}` };
  }
}

/**
 * List available workflow templates.
 */
export function listWorkflows() {
  const workflows = [];

  if (!existsSync(TEMPLATES_DIR)) return workflows;

  const entries = readdirSync(TEMPLATES_DIR);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = resolve(TEMPLATES_DIR, entry);
    try {
      const def = JSON.parse(readFileSync(filePath, "utf-8"));
      workflows.push({
        name: def.name || entry.replace(".json", ""),
        description: def.description || "",
        file: entry,
        steps: def.steps?.length || 0,
      });
    } catch {
      workflows.push({ name: entry.replace(".json", ""), description: "(parse error)", file: entry, steps: 0 });
    }
  }

  return workflows;
}

// ── Active Workflow Tracking ────────────────────────────────────────────────

const _activeWorkflows = new Map(); // id → { definition, startTime, promise }
let _nextId = 1;

/**
 * Start a workflow and track it. Returns a run ID for status queries.
 */
export function startWorkflow(definition, opts = {}) {
  const runId = `wf-${_nextId++}-${Date.now()}`;
  const startTime = Date.now();

  const promise = executeWorkflow(definition, opts).then(result => {
    const entry = _activeWorkflows.get(runId);
    if (entry) {
      entry.result = result;
      entry.status = result.ok ? "completed" : "failed";
      entry.endTime = Date.now();
    }
    return result;
  }).catch(err => {
    const entry = _activeWorkflows.get(runId);
    if (entry) {
      entry.result = { ok: false, error: err.message };
      entry.status = "error";
      entry.endTime = Date.now();
    }
  });

  _activeWorkflows.set(runId, {
    id: runId,
    workflow: definition.name,
    status: "running",
    startTime,
    endTime: null,
    result: null,
    promise,
  });

  return { runId, workflow: definition.name };
}

/**
 * Get the status of a running or completed workflow.
 */
export function getWorkflowStatus(runId) {
  if (runId) {
    const entry = _activeWorkflows.get(runId);
    if (!entry) return null;
    return {
      id: entry.id,
      workflow: entry.workflow,
      status: entry.status,
      startTime: entry.startTime,
      endTime: entry.endTime,
      duration: entry.endTime ? entry.endTime - entry.startTime : Date.now() - entry.startTime,
      result: entry.result,
    };
  }

  // Return all workflows
  return Array.from(_activeWorkflows.values()).map(entry => ({
    id: entry.id,
    workflow: entry.workflow,
    status: entry.status,
    startTime: entry.startTime,
    endTime: entry.endTime,
    duration: entry.endTime ? entry.endTime - entry.startTime : Date.now() - entry.startTime,
  }));
}

// ── CLI Mode ────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const command = process.argv[2];
  const filePath = process.argv[3];
  const dryRun = process.argv.includes("--dry-run");

  if (!command || command === "list") {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      console.log("No workflow templates found. Create JSON files in brain/workflows/templates/");
    } else {
      console.log("Available workflow templates:\n");
      for (const wf of workflows) {
        console.log(`  ${wf.name} — ${wf.description} (${wf.steps} steps)`);
        console.log(`    File: ${wf.file}`);
      }
    }
    process.exit(0);
  }

  if (command === "validate") {
    if (!filePath) {
      console.error("Usage: bun brain/workflows/engine.mjs validate <workflow.json>");
      process.exit(1);
    }

    const loaded = loadWorkflow(filePath);
    if (!loaded.ok) {
      console.error(loaded.error);
      process.exit(1);
    }

    const result = validateWorkflow(loaded.definition);
    if (result.valid) {
      console.log(`Workflow "${loaded.definition.name}" is valid (${loaded.definition.steps.length} steps)`);
      for (const step of loaded.definition.steps) {
        const deps = step.depends?.length ? ` [depends: ${step.depends.join(", ")}]` : "";
        console.log(`  ${step.id} (${step.type})${deps}`);
      }
    } else {
      console.error("Validation errors:");
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "run") {
    if (!filePath) {
      console.error("Usage: bun brain/workflows/engine.mjs run <workflow.json> [--dry-run]");
      process.exit(1);
    }

    const loaded = loadWorkflow(filePath);
    if (!loaded.ok) {
      console.error(loaded.error);
      process.exit(1);
    }

    console.log(`Loading workflow from: ${loaded.path}`);

    const result = await executeWorkflow(loaded.definition, {
      dryRun,
      onStep: (event) => {
        // Already logged by the engine, but could be extended
      },
    });

    if (!result.ok) {
      console.error(`\nWorkflow failed: ${result.error || "aborted"}`);
      process.exit(1);
    }

    console.log("\nWorkflow completed successfully.");
    process.exit(0);
  }

  console.error("Unknown command. Usage:");
  console.error("  bun brain/workflows/engine.mjs run <workflow.json> [--dry-run]");
  console.error("  bun brain/workflows/engine.mjs validate <workflow.json>");
  console.error("  bun brain/workflows/engine.mjs list");
  process.exit(1);
}
