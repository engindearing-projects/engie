#!/usr/bin/env bun

// Familiar Gateway — Bun WebSocket server for agent dispatch.
// Speaks the same protocol as cli/src/gateway.mjs expects:
//   connect.challenge → connect → chat.send / chat.history / sessions.list / health / config.get
//
// Usage:
//   bun scripts/gateway.mjs
//   GATEWAY_PORT=18789 bun scripts/gateway.mjs

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Semaphore,
  cleanEnv,
  stripSessionEnv,
  claudeBin,
  checkOnline,
  invokeClaude,
  PROJECT_DIR,
} from "./shared-invoke.mjs";
import { Router, ROLE_HINTS } from "./router.mjs";
import { runToolLoop, getSoulContent } from "./tool-loop.mjs";
import { warmDaemon, warmMcpServers } from "./tools.mjs";
import { validateResponse } from "./response-validator.mjs";
import { estimateTokens, estimateMessages } from "./token-utils.mjs";
import { runLongTask, findInterruptedTask } from "./task-runner.mjs";
import {
  createSession as dbCreateSession,
  listSessions as dbListSessions,
  getSessionById as dbGetSession,
  renameSession as dbRenameSession,
  archiveSession as dbArchiveSession,
  addSessionMessage as dbAddMessage,
  getSessionMessages as dbGetMessages,
  forkSession as dbForkSession,
  autoTitleSession as dbAutoTitle,
} from "./session-store.mjs";

stripSessionEnv();

// ── Config ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const candidates = [
    resolve(PROJECT_DIR, "config", "familiar.json"),
    resolve(PROJECT_DIR, "config", "cozyterm.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { config: JSON.parse(readFileSync(p, "utf8")), path: p };
      } catch { /* skip bad JSON */ }
    }
  }
  return { config: {}, path: null };
}

const { config, path: configPath } = loadConfig();
const PORT = parseInt(process.env.GATEWAY_PORT || String(config.gateway?.port ?? 18789), 10);
const AUTH_TOKEN = config.gateway?.auth?.token
  || process.env.FAMILIAR_GATEWAY_TOKEN
  || process.env.COZYTERM_GATEWAY_TOKEN
;
const BIND = config.gateway?.bind || "lan";

// Accepted client IDs
const ACCEPTED_CLIENT_IDS = new Set([
  "familiar-ui",
  "familiar-tray",
  "familiar-terminal",
  "familiar-telegram",
  "cozyterm-ui",
]);

// ── Claude Trigger ──────────────────────────────────────────────────────────
// Explicit phrases that invoke Claude. Checked BEFORE routing.
const CLAUDE_TRIGGER = /\b(ask\s+claude|@claude|use\s+claude|claude\s+says|hey\s+claude)\b/i;

const ENGIE_DISALLOWED_TOOLS = [
  "mcp__engie__engie_chat",
  "mcp__engie__engie_claude",
];
const FAMILIAR_MAX_TURNS = 25;
const FAMILIAR_TIMEOUT_MS = 300_000;
const FAMILIAR_MCP_CONFIG = resolve(PROJECT_DIR, "config", "mcp-tools.json");
const FAMILIAR_SYSTEM_PREAMBLE = [
  "You are Engie, a familiar from familiar.run — an AI project manager and coding assistant.",
  "You have read/write access to local memory files in ~/.familiar/memory/.",
  "You have full access to the filesystem, Bash, and all standard Claude Code tools.",
  "You have MCP tools for Jira (Atlassian), Slack, and Figma.",
  "",
  "Guidelines:",
  "- For Jira: use the mcp__atlassian__jira_* tools.",
  "- For Slack: use the mcp__slack__slack_* tools.",
  "- For Figma: use the mcp__figma__* tools.",
  "- For coding tasks: read files, edit code, run builds/tests, commit with git.",
  "- For GitHub: use the `gh` CLI tool.",
  "- Be concise and factual. Summarize results clearly.",
  "- If a tool call fails, mention the error briefly and try an alternative approach.",
  "- Never fabricate ticket numbers, statuses, or data.",
].join("\n");

// ── Smart Router ────────────────────────────────────────────────────────────

const claudeLimiter = new Semaphore(parseInt(process.env.CLAUDE_MAX_CONCURRENT || "2", 10));

const router = new Router({
  proxyUrl: `http://127.0.0.1:${process.env.CLAUDE_PROXY_PORT || 18791}`,
  ollamaUrl: "http://localhost:11434",
  localModel: "familiar-brain:latest",
});

// ── Forge Collectors (lazy-loaded) ──────────────────────────────────────────

let _collector = null;
async function getCollector() {
  if (_collector) return _collector;
  try {
    const { Collector } = await import("../trainer/collector.mjs");
    _collector = new Collector();
    return _collector;
  } catch { return null; }
}

// ── Session Store ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const sessions = new Map(); // sessionKey -> { messages[], lastActivity, claudeSessionId? }

function getSession(key) {
  const s = sessions.get(key);
  if (!s) return null;
  if (Date.now() - s.lastActivity > SESSION_TTL_MS) {
    sessions.delete(key);
    return null;
  }
  s.lastActivity = Date.now();
  return s;
}

function ensureSession(key) {
  let s = getSession(key);
  if (!s) {
    // Start fresh in-memory session. SQLite persistence is for long-term
    // storage and explicit restore — NOT automatic hydration, because
    // stale history from old conversations pollutes new context.
    s = { messages: [], lastActivity: Date.now(), claudeSessionId: null, dbSessionId: null };
    sessions.set(key, s);
  }
  return s;
}

// Cleanup stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS) sessions.delete(key);
  }
}, 600_000);

// ── Greeting Detection ──────────────────────────────────────────────────────

const GREETING_RE = /^(hi|hey|hello|yo|sup|thanks|thank\s+you|good\s+(morning|afternoon|evening|night)|what'?s?\s+up|how\s+are\s+you|how'?s?\s+it\s+going)[\s!.,?]*$/i;

function isPureGreeting(msg, role, conf) {
  return role === "chat" && conf > 0.7 && msg.length < 50 && GREETING_RE.test(msg.trim());
}

// ── Session History Helper ──────────────────────────────────────────────────

const MAX_HISTORY = 10;

function getSessionHistory(session) {
  if (!session?.messages?.length) return [];
  // Exclude the current (last) message, take the most recent MAX_HISTORY
  return session.messages.slice(0, -1).slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }));
}

// ── RAG (lightweight, for non-tool paths) ───────────────────────────────────

let _ragSearch = null;

async function getLightRagContext(query) {
  if (!_ragSearch) {
    try {
      const mod = await import("../brain/rag/index.mjs");
      _ragSearch = mod.search;
    } catch { return ""; }
  }
  try {
    const results = await _ragSearch(query, 2, { minScore: 0.5 });
    if (results.length === 0) return "";
    return results.map(r => r.text.slice(0, 300)).join("\n---\n");
  } catch { return ""; }
}

// ── Context Compaction ──────────────────────────────────────────────────────

const HISTORY_TOKEN_BUDGET = 4000;

async function compactHistory(session, model) {
  const history = getSessionHistory(session);
  if (!history.length) return history;

  const tokens = estimateMessages(history);
  if (tokens <= HISTORY_TOKEN_BUDGET) return history;

  // Split: keep last 4 messages as-is, summarize older ones
  const recent = history.slice(-4);
  const older = history.slice(0, -4);

  if (older.length === 0) return recent;

  // If we already have a cached summary and recent fits in budget, use it
  if (session.contextSummary) {
    const summaryMsg = { role: "system", content: `[Previous context] ${session.contextSummary}` };
    const combined = [summaryMsg, ...recent];
    if (estimateMessages(combined) <= HISTORY_TOKEN_BUDGET) return combined;
  }

  // Summarize older messages via a quick LLM call
  try {
    const olderText = older.map(m => `${m.role}: ${m.content}`).join("\n");
    const summary = await callOllamaDirect({
      prompt: `Summarize this conversation so far in 2-3 sentences:\n\n${olderText}`,
      systemPrompt: "You are a concise summarizer. Output only the summary, nothing else.",
      model,
      temperature: 0.3,
    });
    if (summary && summary.length > 10) {
      session.contextSummary = summary.trim();
      return [{ role: "system", content: `[Previous context] ${session.contextSummary}` }, ...recent];
    }
  } catch { /* summarization failed, just truncate */ }

  // Fallback: just return recent messages
  return recent;
}

// ── Session Persistence (SQLite) ────────────────────────────────────────────

function persistMessage(sessionKey, role, content) {
  try {
    // Ensure a persistent session exists for this key
    let session = sessions.get(sessionKey);
    if (!session?.dbSessionId) {
      const dbSession = dbCreateSession({ title: sessionKey.slice(0, 60) });
      if (session) session.dbSessionId = dbSession.id;
    }
    const dbId = session?.dbSessionId;
    if (dbId) {
      dbAddMessage(dbId, { role, text: content });
    }
  } catch { /* persistence is best-effort */ }
}

function hydrateSession(sessionKey) {
  // Try to restore from SQLite when in-memory session is missing
  try {
    const dbSessions = dbListSessions({ limit: 100 });
    const match = dbSessions.find(s => s.title === sessionKey.slice(0, 60));
    if (!match) return null;

    const msgs = dbGetMessages(match.id, { limit: MAX_HISTORY * 2 });
    if (!msgs?.length) return null;

    const session = {
      messages: msgs.map(m => ({ role: m.role, content: m.text, ts: new Date(m.created).getTime() })),
      lastActivity: Date.now(),
      claudeSessionId: null,
      dbSessionId: match.id,
    };
    sessions.set(sessionKey, session);
    return session;
  } catch { return null; }
}

// ── Auto-Observation ────────────────────────────────────────────────────────

const PREFERENCE_RE = /\b(always|never|prefer|don'?t|stop|use|switch to)\b.{5,80}/i;
const DECISION_RE = /\b(let'?s (go with|use|do)|we'?(re|ll) (using|going|switching))\b.{5,80}/i;
const BLOCKER_RE = /\b(blocked|waiting on|can'?t|haven'?t|hasn'?t)\b.{5,80}/i;

let _memoryStore = null;

async function getMemoryStore() {
  if (_memoryStore) return _memoryStore;
  try {
    const mod = await import("./tools.mjs");
    if (mod.executeTool) {
      _memoryStore = mod.executeTool;
      return _memoryStore;
    }
  } catch { /* no memory store */ }
  return null;
}

function autoObserve(prompt, response, role) {
  // Skip greetings and very short exchanges
  if (isPureGreeting(prompt, role, 1.0)) return;
  if (prompt.length < 20 && response.length < 50) return;

  const observations = [];

  // Check the USER's prompt for preference/decision/blocker signals
  for (const [re, type] of [[PREFERENCE_RE, "preference"], [DECISION_RE, "decision"], [BLOCKER_RE, "blocker"]]) {
    const match = prompt.match(re);
    if (match) {
      observations.push({ type, text: match[0].trim(), source: "auto-observed" });
    }
  }

  if (observations.length === 0) return;

  // Fire-and-forget: store observations via memory_store tool
  getMemoryStore().then(exec => {
    if (!exec) return;
    for (const obs of observations) {
      exec("memory_store", {
        category: obs.type,
        content: obs.text,
        metadata: JSON.stringify({ source: "auto-observed", ts: new Date().toISOString() }),
      }).catch(() => {});
    }
  }).catch(() => {});
}

// ── Session Quality Logging ─────────────────────────────────────────────────

const QUALITY_LOG_DIR = resolve(PROJECT_DIR, "brain", "reflection");

function logSessionQuality({ role, confidence, flags, toolCalls, iterations }) {
  try {
    if (!existsSync(QUALITY_LOG_DIR)) mkdirSync(QUALITY_LOG_DIR, { recursive: true });
    const logPath = resolve(QUALITY_LOG_DIR, "session-quality.jsonl");
    const record = {
      ts: new Date().toISOString(),
      role,
      confidence,
      flags,
      toolCalls: toolCalls?.length || 0,
      iterations: iterations || 0,
    };
    appendFileSync(logPath, JSON.stringify(record) + "\n");
  } catch { /* best-effort */ }
}

// ── Memory Context Builder ───────────────────────────────────────────────────

const MEMORY_DIR = resolve(PROJECT_DIR, "memory");
const MEMORY_FILES = ["projects.md", "repos.md"];
const MEMORY_CACHE_TTL = 60_000; // 60 seconds
let _memoryCache = { text: null, at: 0 };

function buildMemoryContext() {
  if (_memoryCache.text && Date.now() - _memoryCache.at < MEMORY_CACHE_TTL) {
    return _memoryCache.text;
  }
  try {
    const parts = ["[Memory Context]"];
    for (const file of MEMORY_FILES) {
      const p = resolve(MEMORY_DIR, file);
      if (existsSync(p)) {
        const content = readFileSync(p, "utf8").trim();
        if (content) parts.push(`## ${file}\n${content}`);
      }
    }
    parts.push("[/Memory Context]");
    const text = parts.length > 2 ? parts.join("\n") : "";
    _memoryCache = { text, at: Date.now() };
    return text;
  } catch {
    return "";
  }
}

// ── Direct Ollama Call (non-tool models) ─────────────────────────────────────
// For reasoning and chat models that don't use the tool loop.
// Simple prompt → response via /api/generate.

async function callOllamaDirect({ prompt, systemPrompt, model, temperature, history }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  if (history?.length > 0) messages.push(...history);
  messages.push({ role: "user", content: prompt });

  const resp = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        num_predict: 4096,
        temperature: temperature ?? 0.7,
      },
    }),
    signal: AbortSignal.timeout(180_000), // longer timeout for cold starts (glm-4.7-flash)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.message?.content || "";
}

// ── Connected Clients ───────────────────────────────────────────────────────

const clients = new Map(); // ws -> { authed, clientId, connectedAt }

function broadcast(event, payload) {
  const msg = JSON.stringify({ type: "event", event, payload });
  for (const [ws, client] of clients) {
    if (client.authed && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Chat Handler ────────────────────────────────────────────────────────────

async function handleChatSend(ws, reqId, params) {
  const { sessionKey, message } = params;
  if (!sessionKey || !message) {
    return sendTo(ws, { type: "res", id: reqId, ok: false, error: { message: "sessionKey and message required" } });
  }

  const runId = randomUUID().slice(0, 12);
  const session = ensureSession(sessionKey);

  // Acknowledge immediately
  sendTo(ws, { type: "res", id: reqId, ok: true, payload: { runId } });

  // Store user message
  session.messages.push({ role: "user", content: message, ts: Date.now() });

  try {
    let responseText = "";

    // ── Detect task resume requests ──
    const RESUME_RE = /^(continue|resume|keep going|pick up where you left off)[\s!.]*$/i;
    let resumeTaskId = null;
    if (RESUME_RE.test(message.trim())) {
      const interrupted = findInterruptedTask(sessionKey);
      if (interrupted) {
        resumeTaskId = interrupted.id;
        console.log(`[chat] resuming interrupted task ${resumeTaskId}`);
      }
    }

    // ── Route + build system prompt ──
    const isExplicitClaude = CLAUDE_TRIGGER.test(message);
    const effectivePrompt = isExplicitClaude
      ? (message.replace(CLAUDE_TRIGGER, "").trim() || message)
      : message;

    const routeResult = await router.route({ prompt: effectivePrompt, hasCode: /```/.test(message) });
    const { role } = routeResult;
    const roleHint = ROLE_HINTS[role] || "";

    console.log(`[chat] session=${sessionKey.slice(0, 30)} role=${role} route=${routeResult.backend}${isExplicitClaude ? " (explicit)" : ""} score=${routeResult.score?.toFixed(2)}`);

    // Build system prompt with SOUL.md + role hint + memory context
    const soulContent = getSoulContent();
    const memoryCtx = buildMemoryContext();
    const systemParts = [FAMILIAR_SYSTEM_PREAMBLE];
    if (roleHint) systemParts.push(`\n${roleHint}`);
    if (soulContent) systemParts.push(`\n## Identity\n${soulContent.split("\n").slice(0, 15).join("\n")}`);
    if (memoryCtx) systemParts.push(`\n${memoryCtx}`);
    const fullSystemPrompt = systemParts.join("\n");

    const responseStart = Date.now();

    // Progress callback — sends intermediate updates to the client
    const onProgress = (msg) => {
      broadcast("chat", { runId, sessionKey, state: "progress", message: { role: "assistant", content: msg } });
    };

    // Check Claude availability — fall back to local Ollama if offline
    let claudeReady = claudeBin() && await checkOnline();

    let usedFallback = false;

    if (claudeReady) {
      // ── Primary: Claude Code ──
      try {
        const taskResult = await runLongTask({
          prompt: effectivePrompt,
          systemPrompt: fullSystemPrompt,
          claudeOpts: {
            outputFormat: "json",
            permissionMode: "bypassPermissions",
            disallowedTools: ENGIE_DISALLOWED_TOOLS,
            maxTurns: FAMILIAR_MAX_TURNS,
            addDirs: [resolve(PROJECT_DIR, "memory"), resolve(PROJECT_DIR, "workspace")],
            timeoutMs: FAMILIAR_TIMEOUT_MS,
            mcpConfig: FAMILIAR_MCP_CONFIG,
          },
          session,
          limiter: claudeLimiter,
          sessionKey,
          onProgress,
          resumeTaskId,
        });

        responseText = taskResult.text;
        const responseDurationMs = Date.now() - responseStart;

        if (taskResult.continuations > 0) {
          console.log(`[chat] long task done: ${taskResult.continuations} continuations, ${taskResult.totalTurns} turns, $${(taskResult.totalCost || 0).toFixed(4)}`);
        } else {
          console.log(`[chat] claude done: role=${role} duration=${responseDurationMs}ms`);
        }

        // Log session quality
        logSessionQuality({ role, confidence: 1.0, flags: [], toolCalls: null, iterations: 0 });

        // Fire Forge collector — every Claude response is training data
        getCollector().then((c) => {
          if (c) c.collectPair({
            prompt: message,
            routedTo: "claude",
            complexityScore: routeResult.score,
            primaryResponse: responseText,
            primaryDurationMs: responseDurationMs,
          });
        }).catch(() => {});
      } catch (claudeErr) {
        // Claude failed (rate limit, crash, etc.) — fall back to Ollama
        const reason = claudeErr.message?.includes("hit your limit") ? "rate-limited" : "errored";
        console.log(`[chat] Claude ${reason}, falling back to Ollama tool-loop: ${claudeErr.message}`);
        claudeReady = false;
        usedFallback = true;
      }
    }

    if (!claudeReady) {
      // ── Fallback: Local Ollama model ──
      const reason = usedFallback ? "Claude failed, using local model" : "Claude is offline";
      console.log(`[chat] ${reason}, falling back to Ollama tool-loop`);
      broadcast("chat", { runId, sessionKey, state: "progress", message: { role: "assistant", content: `(Running on local model — ${reason})` } });

      const loopResult = await runToolLoop({
        prompt: effectivePrompt,
        systemPrompt: fullSystemPrompt,
        model: routeResult.model || "familiar-coder:latest",
        maxIterations: 10,
        maxToolCalls: 25,
        timeoutMs: 120_000,
      });

      responseText = loopResult.response || "(no response)";
      const responseDurationMs = Date.now() - responseStart;
      console.log(`[chat] ollama fallback done: ${loopResult.iterations} iters, ${loopResult.toolCalls.length} tools, duration=${responseDurationMs}ms`);

      logSessionQuality({ role, confidence: 0.5, flags: [usedFallback ? "claude-fallback" : "offline-fallback"], toolCalls: loopResult.toolCalls.length, iterations: loopResult.iterations });
    }

    broadcast("agent", { runId, sessionKey, stream: "assistant", data: { delta: responseText } });

    // Store assistant message
    session.messages.push({ role: "assistant", content: responseText, ts: Date.now() });

    // Persist to SQLite (fire-and-forget)
    persistMessage(sessionKey, "user", message);
    persistMessage(sessionKey, "assistant", responseText);

    // Auto-observe preferences, decisions, blockers (fire-and-forget)
    autoObserve(message, responseText, "chat");

    // Broadcast final
    broadcast("chat", {
      runId,
      sessionKey,
      state: "final",
      message: { role: "assistant", content: responseText },
    });
  } catch (err) {
    console.error(`[chat] error for ${sessionKey}:`, err.message);
    broadcast("chat", {
      runId,
      sessionKey,
      state: "error",
      error: err.message,
      errorMessage: err.message,
    });
  }
}

// ── Request Dispatch ────────────────────────────────────────────────────────

function handleRequest(ws, msg) {
  const { id, method, params = {} } = msg;

  switch (method) {
    case "connect":
      return handleConnect(ws, id, params);

    case "chat.send":
      // Fire-and-forget async — response is sent inside
      handleChatSend(ws, id, params);
      return;

    case "chat.history": {
      const session = getSession(params.sessionKey);
      const limit = params.limit || 20;
      const messages = session ? session.messages.slice(-limit) : [];
      return sendTo(ws, { type: "res", id, ok: true, payload: { messages } });
    }

    case "sessions.list": {
      const list = [];
      for (const [key, s] of sessions) {
        list.push({
          sessionKey: key,
          messageCount: s.messages.length,
          lastActivity: s.lastActivity,
          idleMs: Date.now() - s.lastActivity,
          hasClaudeSession: !!s.claudeSessionId,
        });
      }
      return sendTo(ws, { type: "res", id, ok: true, payload: { sessions: list } });
    }

    case "sessions.reset": {
      if (params.sessionKey) {
        sessions.delete(params.sessionKey);
      }
      return sendTo(ws, { type: "res", id, ok: true, payload: { ok: true } });
    }

    case "health":
      return handleHealth(ws, id);

    case "config.get":
      return handleConfigGet(ws, id);

    // ── Persistent Session Management ──
    case "session.create": {
      try {
        const session = dbCreateSession({ title: params.title, workingDir: params.workingDir });
        return sendTo(ws, { type: "res", id, ok: true, payload: session });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.list": {
      try {
        const sessions = dbListSessions({ includeArchived: params.includeArchived, limit: params.limit });
        return sendTo(ws, { type: "res", id, ok: true, payload: { sessions } });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.get": {
      try {
        const session = dbGetSession(params.sessionId);
        if (!session) return sendTo(ws, { type: "res", id, ok: false, error: { message: "Session not found" } });
        return sendTo(ws, { type: "res", id, ok: true, payload: session });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.rename": {
      try {
        dbRenameSession(params.sessionId, params.title);
        return sendTo(ws, { type: "res", id, ok: true, payload: { ok: true } });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.archive": {
      try {
        dbArchiveSession(params.sessionId, params.archived ?? true);
        return sendTo(ws, { type: "res", id, ok: true, payload: { ok: true } });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.fork": {
      try {
        const forked = dbForkSession(params.sessionId, { title: params.title, upToMessageId: params.upToMessageId });
        return sendTo(ws, { type: "res", id, ok: true, payload: forked });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.messages": {
      try {
        const messages = dbGetMessages(params.sessionId, { limit: params.limit, offset: params.offset });
        return sendTo(ws, { type: "res", id, ok: true, payload: { messages } });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    case "session.addMessage": {
      try {
        const msgId = dbAddMessage(params.sessionId, { role: params.role, text: params.text, metadata: params.metadata });
        dbAutoTitle(params.sessionId);
        return sendTo(ws, { type: "res", id, ok: true, payload: { messageId: msgId } });
      } catch (err) {
        return sendTo(ws, { type: "res", id, ok: false, error: { message: err.message } });
      }
    }

    default:
      return sendTo(ws, { type: "res", id, ok: false, error: { message: `Unknown method: ${method}` } });
  }
}

function handleConnect(ws, id, params) {
  const clientId = params.client?.id;
  const token = params.auth?.token;

  // Validate client ID (accept both old and new)
  if (clientId && !ACCEPTED_CLIENT_IDS.has(clientId)) {
    console.log(`[auth] rejected unknown client: ${clientId}`);
    return sendTo(ws, { type: "res", id, ok: false, error: { message: "Unknown client ID" } });
  }

  // Validate auth token
  if (AUTH_TOKEN && token !== AUTH_TOKEN) {
    console.log(`[auth] rejected bad token from ${clientId}`);
    return sendTo(ws, { type: "res", id, ok: false, error: { message: "Invalid auth token" } });
  }

  const client = clients.get(ws);
  if (client) {
    client.authed = true;
    client.clientId = clientId;
  }

  console.log(`[auth] connected: ${clientId}`);
  return sendTo(ws, {
    type: "res",
    id,
    ok: true,
    payload: {
      protocol: 3,
      server: { id: "cozyterm-gateway", version: "1.0.0" },
    },
  });
}

async function handleHealth(ws, id) {
  const bin = claudeBin();
  const online = await checkOnline();

  let ollamaUp = false;
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    ollamaUp = r.ok;
  } catch { /* offline */ }

  sendTo(ws, {
    type: "res",
    id,
    ok: true,
    payload: {
      status: "ok",
      gateway: "cozyterm",
      version: "1.0.0",
      uptime: process.uptime(),
      claudeAvailable: !!bin,
      claudePath: bin,
      online,
      ollamaAvailable: ollamaUp,
      activeSessions: sessions.size,
      connectedClients: clients.size,
    },
  });
}

function handleConfigGet(ws, id) {
  // Return sanitized config (strip auth token)
  const safe = { ...config };
  if (safe.gateway?.auth) {
    safe.gateway = { ...safe.gateway, auth: { mode: "token", token: "***" } };
  }
  sendTo(ws, { type: "res", id, ok: true, payload: safe });
}

// ── Bun Server ──────────────────────────────────────────────────────────────

const hostname = BIND === "lan" ? "0.0.0.0" : "127.0.0.1";

const server = Bun.serve({
  port: PORT,
  hostname,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const origin = req.headers.get("origin") || "";
      if (server.upgrade(req, { data: { origin } })) {
        return;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // HTTP /health endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      const bin = claudeBin();
      return Response.json({
        status: "ok",
        gateway: "cozyterm",
        version: "1.0.0",
        uptime: process.uptime(),
        claudeAvailable: !!bin,
        activeSessions: sessions.size,
        connectedClients: clients.size,
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      clients.set(ws, { authed: false, clientId: null, connectedAt: Date.now() });
      // Send connect challenge
      sendTo(ws, { type: "event", event: "connect.challenge", payload: {} });
    },

    message(ws, raw) {
      let msg;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }

      if (msg.type === "req") {
        handleRequest(ws, msg);
      }
    },

    close(ws) {
      clients.delete(ws);
    },
  },
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[gateway] ${signal} received, shutting down...`);
  for (const [ws] of clients) {
    try { ws.close(1001, "Server shutting down"); } catch {}
  }
  clients.clear();
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Startup Banner ──────────────────────────────────────────────────────────

const bin = claudeBin();
console.log(`Familiar Gateway v2.1.0 (Claude-First Architecture)`);
console.log(`  listening:    ${hostname}:${PORT}`);
console.log(`  config:       ${configPath || "none"}`);
console.log(`  sessions TTL: ${SESSION_TTL_MS / 60000} min`);
console.log(`  persistence:  SQLite (survives restarts)`);
console.log(`  claude:       ${bin ? "available" : "NOT FOUND"}`);
console.log("");
console.log("Routing: ALL requests → Claude (via subscription)");
console.log("  SOUL.md personality + memory context injected");
console.log("  Multi-turn sessions with Claude session resume");
console.log("  Every response feeds Forge training pipeline");
console.log("");
console.log("Features: session persistence, auto-observe, quality logging, Forge collection");
console.log("");

// Pre-warm the daemon connection so tool schemas are ready for first request
warmDaemon().then(() => {
  console.log("  daemon:  familiar-daemon connected");
}).catch(() => {
  console.log("  daemon:  familiar-daemon not available (will lazy-connect on first tool call)");
});

// Pre-warm external MCP servers (Jira, Slack, etc.)
warmMcpServers().then(() => {
  console.log("  mcp:     external servers connected");
}).catch(() => {
  console.log("  mcp:     external servers unavailable (will lazy-connect on first tool call)");
});
