#!/usr/bin/env bun

// Hand Runner — executes a hand's phases sequentially
//
// Each phase gets a system prompt derived from the hand's manifest
// and the phase prompt. The runner tracks timing, errors, and metrics.
//
// Usage:
//   import { runHand } from "./runner.mjs";
//   const result = await runHand(registry, "forge-miner");
//
// CLI:
//   bun brain/hands/runner.mjs <hand-name> [--dry-run]

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { HandRegistry } from "./registry.mjs";

const PROJECT_DIR = resolve(import.meta.dir, "../..");
const OLLAMA_URL = "http://localhost:11434";
const CLAUDE_PROXY_URL = "http://localhost:18791/v1";
const BRAIN_MODEL = "familiar-brain:latest";

// Load env for Telegram notifications
let botToken = null;
let chatId = null;
try {
  const envFile = resolve(PROJECT_DIR, "config/.env");
  if (existsSync(envFile)) {
    const envContent = readFileSync(envFile, "utf-8");
    for (const line of envContent.split("\n")) {
      const [key, ...rest] = line.split("=");
      const val = rest.join("=").trim().replace(/^["']|["']$/g, "");
      if (key.trim() === "TELEGRAM_BOT_TOKEN") botToken = val;
      if (key.trim() === "TELEGRAM_CHAT_ID") chatId = val;
    }
  }
} catch { /* env not available */ }

async function notify(text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* best effort */ }
}

// ── LLM Providers ──────────────────────────────────────────────────────────

async function chatOllama(systemPrompt, userPrompt, timeout = 90000) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: BRAIN_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      options: { num_predict: 4096, temperature: 0.5 },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || "";
}

async function chatClaude(systemPrompt, userPrompt, timeout = 60000) {
  const res = await fetch(`${CLAUDE_PROXY_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer subscription",
    },
    body: JSON.stringify({
      model: "claude-subscription",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Claude proxy error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function chat(systemPrompt, userPrompt, timeout = 90000) {
  try {
    return await chatClaude(systemPrompt, userPrompt, timeout);
  } catch {
    return chatOllama(systemPrompt, userPrompt, timeout);
  }
}

// ── Phase Executor ─────────────────────────────────────────────────────────

async function executePhase(hand, phase, context) {
  const startTime = Date.now();
  const timeoutMs = (phase.timeout || 300) * 1000;

  const systemPrompt = [
    `You are Familiar, an autonomous AI assistant running the "${hand.manifest.name}" hand.`,
    hand.manifest.description,
    "",
    `Current phase: ${phase.name}`,
    `Available tools: ${(hand.manifest.tools || []).join(", ") || "none"}`,
    "",
    context.checkpoint ? `Previous checkpoint: ${JSON.stringify(context.checkpoint)}` : "",
    context.previousPhases.length > 0
      ? `Previous phase results:\n${context.previousPhases.map(p => `[${p.name}]: ${p.result?.slice(0, 500) || "no output"}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  try {
    const result = await chat(systemPrompt, phase.prompt, timeoutMs);
    return {
      name: phase.name,
      status: "ok",
      result,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: phase.name,
      status: "error",
      error: err.message,
      duration: Date.now() - startTime,
    };
  }
}

// ── Hand Runner ────────────────────────────────────────────────────────────

/**
 * Run a hand's phases sequentially.
 *
 * @param {HandRegistry} registry
 * @param {string} name - Hand name
 * @param {object} opts
 * @param {boolean} opts.dryRun - Log but don't execute
 * @param {boolean} opts.notify - Send Telegram notification
 * @returns {Promise<{ok: boolean, phases: Array, duration: number, metrics: object}>}
 */
export async function runHand(registry, name, opts = {}) {
  const hand = registry.get(name);
  if (!hand) return { ok: false, error: `Hand "${name}" not found` };

  // Check guardrails
  if (hand.manifest.guardrails?.maxConcurrent === 1 && hand.status === "running") {
    return { ok: false, error: `Hand "${name}" is already running` };
  }

  if (hand.manifest.guardrails?.approvalRequired) {
    return { ok: false, error: `Hand "${name}" requires approval (not yet implemented)` };
  }

  const startTime = Date.now();
  registry.markRunning(name);

  console.log(`[hand:${name}] Starting (${hand.manifest.phases.length} phases)`);

  const context = {
    checkpoint: hand.checkpoint,
    previousPhases: [],
  };

  const phaseResults = [];
  let aborted = false;

  for (const phase of hand.manifest.phases) {
    if (aborted) break;

    console.log(`[hand:${name}] Phase: ${phase.name}`);

    if (opts.dryRun) {
      console.log(`[hand:${name}]   (dry run) Would execute: ${phase.prompt.slice(0, 100)}...`);
      phaseResults.push({ name: phase.name, status: "skipped", duration: 0 });
      continue;
    }

    const result = await executePhase(hand, phase, context);
    phaseResults.push(result);

    if (result.status === "error") {
      const onFail = phase.onFail || "abort";
      console.log(`[hand:${name}]   Phase "${phase.name}" failed: ${result.error} (onFail: ${onFail})`);

      if (onFail === "abort") {
        aborted = true;
      } else if (onFail === "retry") {
        console.log(`[hand:${name}]   Retrying phase "${phase.name}"...`);
        const retry = await executePhase(hand, phase, context);
        phaseResults.push({ ...retry, name: `${phase.name} (retry)` });
        if (retry.status === "error") {
          aborted = true;
        } else {
          context.previousPhases.push(retry);
        }
      }
      // "skip" — just continue to next phase
    } else {
      context.previousPhases.push(result);
      console.log(`[hand:${name}]   Phase "${phase.name}" complete (${result.duration}ms)`);
    }
  }

  const duration = Date.now() - startTime;

  // Extract metrics from phase results if any phase returned JSON with a _metrics key
  const extractedMetrics = {};
  for (const pr of phaseResults) {
    if (!pr.result) continue;
    try {
      const match = pr.result.match(/\{[\s\S]*"_metrics"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed._metrics) Object.assign(extractedMetrics, parsed._metrics);
      }
    } catch { /* not JSON or no metrics */ }
  }

  // Record the run
  registry.recordRun(name, {
    duration,
    error: aborted ? phaseResults.find(p => p.status === "error")?.error : null,
    metrics: {
      run_duration: duration / 1000,
      ...extractedMetrics,
    },
    checkpoint: context.previousPhases.length > 0
      ? { lastPhase: context.previousPhases[context.previousPhases.length - 1].name, at: new Date().toISOString() }
      : hand.checkpoint,
  });

  const summary = {
    ok: !aborted,
    hand: name,
    phases: phaseResults.map(p => ({ name: p.name, status: p.status, duration: p.duration })),
    duration,
    metrics: extractedMetrics,
  };

  // Notify
  if (opts.notify !== false) {
    const statusEmoji = aborted ? "x" : "ok";
    const phaseSummary = phaseResults
      .map(p => `  ${p.status === "ok" ? "[ok]" : "[FAIL]"} ${p.name} (${(p.duration / 1000).toFixed(1)}s)`)
      .join("\n");

    await notify(
      `Hand: ${name} ${statusEmoji === "ok" ? "completed" : "failed"}\n` +
      `Duration: ${(duration / 1000).toFixed(1)}s\n` +
      `Phases:\n${phaseSummary}`
    );
  }

  console.log(`[hand:${name}] ${aborted ? "Aborted" : "Complete"} in ${(duration / 1000).toFixed(1)}s`);
  return summary;
}

// ── CLI Mode ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const handName = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!handName) {
    const registry = new HandRegistry();
    registry.load();
    const hands = registry.list();

    if (hands.length === 0) {
      console.log("No hands installed. Create a HAND.json in brain/hands/<name>/");
    } else {
      console.log("Installed hands:\n");
      for (const h of hands) {
        const status = {
          active: "[ACTIVE]",
          inactive: "[ off  ]",
          paused: "[PAUSED]",
          running: "[ RUN  ]",
          error: "[ERROR ]",
        }[h.status] || `[${h.status}]`;

        console.log(`  ${status} ${h.name} — ${h.description}`);
        console.log(`         Schedule: ${h.schedule} | Runs: ${h.runCount} | Last: ${h.lastRun || "never"}`);
      }
    }
    process.exit(0);
  }

  const registry = new HandRegistry();
  registry.load();

  const result = await runHand(registry, handName, { dryRun, notify: !dryRun });
  if (!result.ok) {
    console.error(`Failed: ${result.error || "aborted"}`);
    process.exit(1);
  }
}
