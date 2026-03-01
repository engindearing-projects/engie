// Workflow Schema — validates workflow definition JSON
//
// A workflow chains hands, tasks, and conditions into a dependency graph.
// Steps execute respecting dependencies, with parallel execution of
// independent steps and conditional branching.
//
// Usage:
//   import { validateWorkflow } from "./schema.mjs";
//   const result = validateWorkflow(definition);
//   // { valid: true } or { valid: false, errors: [...] }

const VALID_STEP_TYPES = new Set(["hand", "task", "condition"]);
const VALID_ON_ERROR = new Set(["retry", "skip", "abort"]);

/**
 * Validate a workflow definition.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateWorkflow(def) {
  const errors = [];

  // Top-level fields
  if (!def.name || typeof def.name !== "string") {
    errors.push("'name' is required and must be a string");
  } else if (!/^[a-z0-9_-]+$/.test(def.name)) {
    errors.push("'name' must be lowercase alphanumeric with hyphens/underscores");
  }

  if (def.description && typeof def.description !== "string") {
    errors.push("'description' must be a string");
  }

  if (def.timeout != null && (typeof def.timeout !== "number" || def.timeout <= 0)) {
    errors.push("'timeout' must be a positive number (seconds)");
  }

  // Steps
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push("'steps' must be a non-empty array");
    return { valid: false, errors };
  }

  const stepIds = new Set();
  const stepMap = new Map();

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const prefix = `steps[${i}]`;

    // ID
    if (!step.id || typeof step.id !== "string") {
      errors.push(`${prefix}: 'id' is required and must be a string`);
      continue;
    }
    if (stepIds.has(step.id)) {
      errors.push(`${prefix}: duplicate step id "${step.id}"`);
    }
    stepIds.add(step.id);
    stepMap.set(step.id, step);

    // Type
    if (!step.type || !VALID_STEP_TYPES.has(step.type)) {
      errors.push(`${prefix}: 'type' must be one of: ${[...VALID_STEP_TYPES].join(", ")}`);
    }

    // Type-specific validation
    if (step.type === "hand") {
      if (!step.hand || typeof step.hand !== "string") {
        errors.push(`${prefix}: hand steps require 'hand' (hand name)`);
      }
    }

    if (step.type === "task") {
      if (!step.command || typeof step.command !== "string") {
        errors.push(`${prefix}: task steps require 'command'`);
      }
    }

    if (step.type === "condition") {
      if (!step.check || typeof step.check !== "string") {
        errors.push(`${prefix}: condition steps require 'check' expression`);
      }
      if (!step.then || typeof step.then !== "string") {
        errors.push(`${prefix}: condition steps require 'then' (step id to run if true)`);
      }
      // 'else' is optional — if not set, skip when false
    }

    // Dependencies
    if (step.depends) {
      if (!Array.isArray(step.depends)) {
        errors.push(`${prefix}: 'depends' must be an array of step ids`);
      } else {
        for (const dep of step.depends) {
          if (typeof dep !== "string") {
            errors.push(`${prefix}: dependency values must be strings`);
          }
        }
      }
    }

    // Error handling
    if (step.onError && !VALID_ON_ERROR.has(step.onError)) {
      errors.push(`${prefix}: 'onError' must be one of: ${[...VALID_ON_ERROR].join(", ")}`);
    }

    // Timeout
    if (step.timeout != null && (typeof step.timeout !== "number" || step.timeout <= 0)) {
      errors.push(`${prefix}: 'timeout' must be a positive number (seconds)`);
    }

    // Retries
    if (step.retries != null && (typeof step.retries !== "number" || step.retries < 0)) {
      errors.push(`${prefix}: 'retries' must be a non-negative number`);
    }
  }

  // Validate dependency references exist
  for (const step of def.steps) {
    if (!step.depends) continue;
    for (const dep of step.depends) {
      if (!stepIds.has(dep)) {
        errors.push(`step "${step.id}": depends on unknown step "${dep}"`);
      }
    }
  }

  // Validate condition targets exist
  for (const step of def.steps) {
    if (step.type !== "condition") continue;
    if (step.then && !stepIds.has(step.then)) {
      errors.push(`step "${step.id}": 'then' references unknown step "${step.then}"`);
    }
    if (step.else && !stepIds.has(step.else)) {
      errors.push(`step "${step.id}": 'else' references unknown step "${step.else}"`);
    }
  }

  // Check for circular dependencies
  const circularError = detectCycles(def.steps, stepMap);
  if (circularError) {
    errors.push(circularError);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Detect circular dependencies in the step graph.
 * Returns an error string if a cycle is found, null otherwise.
 */
function detectCycles(steps, stepMap) {
  const visited = new Set();
  const inStack = new Set();

  function dfs(id) {
    if (inStack.has(id)) return `Circular dependency detected involving step "${id}"`;
    if (visited.has(id)) return null;

    visited.add(id);
    inStack.add(id);

    const step = stepMap.get(id);
    if (step?.depends) {
      for (const dep of step.depends) {
        const err = dfs(dep);
        if (err) return err;
      }
    }

    inStack.delete(id);
    return null;
  }

  for (const step of steps) {
    if (!step.id) continue;
    const err = dfs(step.id);
    if (err) return err;
  }

  return null;
}

export default validateWorkflow;
