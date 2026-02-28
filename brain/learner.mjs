#!/usr/bin/env bun

// Daily Learning Cycle
// Runs 5 steps: REFLECT → LEARN → INSTALL → IDEATE → INGEST
//
// Run: bun brain/learner.mjs
// Dry run: bun brain/learner.mjs --dry-run
// Launchd: com.familiar.learner at 5 AM daily

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { randomUUID } from "crypto";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const BRAIN_DIR = import.meta.dir;
const TRACES_DIR = resolve(PROJECT_DIR, "trainer/data/traces");
const REFLECTION_DIR = resolve(BRAIN_DIR, "reflection/daily");
const IDEAS_FILE = resolve(BRAIN_DIR, "ideas/ideas.jsonl");
const SKILLS_DIR = resolve(BRAIN_DIR, "skills");
const REGISTRY_PATH = resolve(SKILLS_DIR, "registry.json");
const IMPROVEMENTS_FILE = resolve(BRAIN_DIR, "reflection/improvements.jsonl");

const OLLAMA_URL = "http://localhost:11434";
const BRAIN_MODEL = "familiar-coder:latest";
const DRY_RUN = process.argv.includes("--dry-run");

// Ensure dirs exist
for (const dir of [REFLECTION_DIR, resolve(BRAIN_DIR, "ideas"), SKILLS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Telegram Notifications ──────────────────────────────────────────────────

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
  botToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
  chatId = chatId || process.env.TELEGRAM_CHAT_ID;
} catch { /* env not available */ }

async function notify(text) {
  if (DRY_RUN) {
    console.log(`[notify] ${text}`);
    return;
  }

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
  } catch (err) {
    console.error("[notify] Telegram error:", err.message);
  }
}

// ── Ollama Chat ─────────────────────────────────────────────────────────────

async function chat(systemPrompt, userPrompt) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: BRAIN_MODEL,
      messages,
      stream: false,
      options: { num_predict: 2048, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || "";
}

// ── Step 1: REFLECT ─────────────────────────────────────────────────────────

async function reflect() {
  console.log("[learner] Step 1: REFLECT");

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Read yesterday's traces
  const traceFile = join(TRACES_DIR, `${yesterday}-agent.jsonl`);
  let traceData = [];
  if (existsSync(traceFile)) {
    const lines = readFileSync(traceFile, "utf-8").split("\n").filter(Boolean);
    traceData = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  // Count tool calls and analyze
  const toolCounts = {};
  const topics = [];
  const failures = [];

  for (const trace of traceData) {
    const tools = trace.metadata?.tools_used || [];
    for (const t of tools) {
      toolCounts[t] = (toolCounts[t] || 0) + 1;
    }

    if (trace.prompt) topics.push(trace.prompt.slice(0, 100));
    if (trace.metadata?.finish_reason !== "complete") {
      failures.push({
        prompt: trace.prompt?.slice(0, 100),
        reason: trace.metadata?.finish_reason,
      });
    }
  }

  // Ask the brain model to identify gaps
  let gaps = [];
  if (traceData.length > 0) {
    const topicSummary = topics.slice(0, 10).join("\n- ");
    const failureSummary = failures.length > 0
      ? failures.slice(0, 5).map(f => `"${f.prompt}" (${f.reason})`).join("\n- ")
      : "None";

    try {
      const analysis = await chat(
        "You are an AI that analyzes its own performance. Identify gaps — things you couldn't do or did poorly.",
        `Yesterday's activity:\n- ${traceData.length} conversations\n- Topics:\n- ${topicSummary}\n- Failures:\n- ${failureSummary}\n\nIdentify 1-3 specific gaps or things to learn. Output JSON array: [{"gap": "description", "impact": "high|medium|low"}]`
      );

      try {
        const match = analysis.match(/\[[\s\S]*\]/);
        if (match) gaps = JSON.parse(match[0]);
      } catch { /* parse error, continue */ }
    } catch (err) {
      console.log(`[learner] Reflection model unavailable: ${err.message}`);
    }
  }

  const reflection = {
    date: today,
    yesterday,
    conversationCount: traceData.length,
    toolCounts,
    topTopics: topics.slice(0, 5),
    failures: failures.slice(0, 5),
    gaps,
    timestamp: new Date().toISOString(),
  };

  const reflectionPath = join(REFLECTION_DIR, `${today}.json`);
  if (!DRY_RUN) {
    writeFileSync(reflectionPath, JSON.stringify(reflection, null, 2));
  }

  console.log(`[learner] Reflected: ${traceData.length} conversations, ${gaps.length} gaps identified`);
  return reflection;
}

// ── Step 2: LEARN ───────────────────────────────────────────────────────────

async function learn(reflection) {
  console.log("[learner] Step 2: LEARN");

  const gaps = reflection.gaps || [];
  if (gaps.length === 0) {
    console.log("[learner] No gaps to learn from");
    return null;
  }

  // Pick highest impact gap
  const gap = gaps.sort((a, b) => {
    const order = { high: 3, medium: 2, low: 1 };
    return (order[b.impact] || 0) - (order[a.impact] || 0);
  })[0];

  console.log(`[learner] Learning about: ${gap.gap}`);

  // Research the gap
  let findings = "";
  try {
    findings = await chat(
      "You are a research assistant. Provide practical, actionable information.",
      `Research this gap in my capabilities: "${gap.gap}"\n\nProvide:\n1. What this capability involves\n2. How to implement it (tools, APIs, approaches)\n3. A concrete example\n\nKeep it under 500 words.`
    );
  } catch (err) {
    console.log(`[learner] Learning model unavailable: ${err.message}`);
    return null;
  }

  console.log(`[learner] Learned: ${findings.slice(0, 100)}...`);
  return { gap, findings };
}

// ── Step 3: INSTALL ─────────────────────────────────────────────────────────

async function install(learning) {
  console.log("[learner] Step 3: INSTALL");

  if (!learning) {
    console.log("[learner] Nothing to install");
    return null;
  }

  // Ask the brain if this can become a skill
  let skillSpec = null;
  try {
    const response = await chat(
      "You are a tool designer. Design a simple tool/skill based on the research findings. The skill must be implementable as a single JavaScript module that exports { name, description, parameters, execute }.",
      `Gap: ${learning.gap.gap}\n\nFindings:\n${learning.findings}\n\nDesign a skill. Output JSON: {"name": "skill_name", "description": "what it does", "parameters": {"param1": {"type": "string", "description": "desc"}}, "canImplement": true/false, "reason": "why or why not"}\n\nOnly set canImplement to true if this can be a simple, read-only tool (no destructive operations).`
    );

    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) skillSpec = JSON.parse(match[0]);
    } catch { /* parse error */ }
  } catch (err) {
    console.log(`[learner] Install model unavailable: ${err.message}`);
    return null;
  }

  if (!skillSpec?.canImplement) {
    console.log(`[learner] Skill not installable: ${skillSpec?.reason || "unknown"}`);
    return skillSpec;
  }

  // Log the proposed skill — don't auto-create code yet
  // Require Telegram approval before creating actual code
  const proposal = {
    ...skillSpec,
    proposedAt: new Date().toISOString(),
    status: "proposed",
    approved: false,
  };

  if (!DRY_RUN) {
    const improvementEntry = {
      type: "skill_proposal",
      ...proposal,
      timestamp: new Date().toISOString(),
    };
    const improvementsDir = resolve(BRAIN_DIR, "reflection");
    if (!existsSync(improvementsDir)) mkdirSync(improvementsDir, { recursive: true });

    const fs = await import("fs");
    fs.appendFileSync(IMPROVEMENTS_FILE, JSON.stringify(improvementEntry) + "\n");
  }

  console.log(`[learner] Proposed skill: ${skillSpec.name} — ${skillSpec.description}`);
  return proposal;
}

// ── Step 4: IDEATE ──────────────────────────────────────────────────────────

async function ideate() {
  console.log("[learner] Step 4: IDEATE");

  // Query RAG for user context
  let ragContext = "";
  try {
    const { search } = await import("./rag/index.mjs");
    const results = await search("what is Grant working on", 3);
    ragContext = results.map(r => r.text.slice(0, 300)).join("\n---\n");
  } catch (err) {
    console.log(`[learner] RAG unavailable: ${err.message}`);
  }

  let idea = null;
  try {
    const categories = [
      "personal — deadlines, blockers, health reminders",
      "family — schedules, education ideas, activities",
      "community — local events, civic tech, volunteering",
      "global — open source, research, climate",
      "humanitarian — trafficking awareness, disaster response, accessibility, missing persons",
    ];

    const response = await chat(
      `You are a helpful AI that generates actionable ideas. Prioritize ideas that help those who can't help themselves — children, trafficking victims, disaster-affected communities. Be specific and practical.`,
      `Based on what you know about the user:\n\n${ragContext || "(no context available)"}\n\nCategories (weighted by impact):\n${categories.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nGenerate ONE actionable idea. Output JSON: {"category": "personal|family|community|global|humanitarian", "title": "short title", "description": "2-3 sentence actionable description", "impact": "high|medium|low"}`
    );

    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) idea = JSON.parse(match[0]);
    } catch { /* parse error */ }
  } catch (err) {
    console.log(`[learner] Ideate model unavailable: ${err.message}`);
  }

  if (idea) {
    const entry = {
      id: randomUUID().slice(0, 12),
      ...idea,
      timestamp: new Date().toISOString(),
      status: "new",
    };

    if (!DRY_RUN) {
      const fs = await import("fs");
      fs.appendFileSync(IDEAS_FILE, JSON.stringify(entry) + "\n");
    }

    console.log(`[learner] Idea: [${idea.category}] ${idea.title}`);
  }

  return idea;
}

// ── Step 5: INGEST ──────────────────────────────────────────────────────────

async function ingest() {
  console.log("[learner] Step 5: INGEST");

  if (DRY_RUN) {
    console.log("[learner] (dry run — skipping ingest)");
    return;
  }

  try {
    // Run the RAG ingest pipeline
    const { execSync } = await import("child_process");
    execSync(`/opt/homebrew/bin/bun ${resolve(BRAIN_DIR, "rag/ingest.mjs")}`, {
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: PROJECT_DIR,
    });
    console.log("[learner] RAG updated");
  } catch (err) {
    console.error("[learner] Ingest error:", err.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log(`[learner] Starting daily learning cycle ${DRY_RUN ? "(DRY RUN)" : ""}`);
  console.log(`[learner] Date: ${new Date().toISOString().slice(0, 10)}`);

  const results = {
    reflection: null,
    learning: null,
    skill: null,
    idea: null,
  };

  try {
    // Step 1: Reflect
    results.reflection = await reflect();

    // Step 2: Learn
    results.learning = await learn(results.reflection);

    // Step 3: Install (propose skill)
    results.skill = await install(results.learning);

    // Step 4: Ideate
    results.idea = await ideate();

    // Step 5: Ingest new data into RAG
    await ingest();
  } catch (err) {
    console.error("[learner] Cycle error:", err.message);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[learner] Cycle complete in ${duration}s`);

  // Send daily summary via Telegram
  const summaryParts = [`Daily learning cycle (${duration}s):`];

  if (results.reflection) {
    summaryParts.push(`Reflected on ${results.reflection.conversationCount} conversations`);
    if (results.reflection.gaps.length > 0) {
      summaryParts.push(`Gaps: ${results.reflection.gaps.map(g => g.gap).join(", ")}`);
    }
  }

  if (results.learning) {
    summaryParts.push(`Learned: ${results.learning.gap.gap}`);
  }

  if (results.skill) {
    summaryParts.push(`Proposed skill: ${results.skill.name || "none"}`);
  }

  if (results.idea) {
    summaryParts.push(`Idea [${results.idea.category}]: ${results.idea.title}`);
  }

  await notify(summaryParts.join("\n"));
}

main().catch(err => {
  console.error("[learner] Fatal:", err.message);
  process.exit(1);
});
