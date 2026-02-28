#!/usr/bin/env bun

// Familiar Gateway — Bun WebSocket server for agent dispatch.
// Speaks the same protocol as cli/src/gateway.mjs expects:
//   connect.challenge → connect → chat.send / chat.history / sessions.list / health / config.get
//
// Usage:
//   bun scripts/gateway.mjs
//   GATEWAY_PORT=18789 bun scripts/gateway.mjs

import { readFileSync, existsSync } from "node:fs";
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
import { Router } from "./router.mjs";
import { runToolLoop } from "./tool-loop.mjs";
import { warmDaemon, warmMcpServers } from "./tools.mjs";
import { validateResponse } from "./response-validator.mjs";
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
    s = { messages: [], lastActivity: Date.now(), claudeSessionId: null };
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

async function callOllamaDirect({ prompt, systemPrompt, model, temperature }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
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

    // ── 1. Check for explicit Claude trigger ──
    if (CLAUDE_TRIGGER.test(message)) {
      // Strip the trigger phrase from the prompt sent to Claude
      const cleanedPrompt = message.replace(CLAUDE_TRIGGER, "").trim() || message;
      console.log(`[chat] session=${sessionKey.slice(0, 30)} route=claude (explicit trigger)`);

      if (!claudeBin()) {
        throw new Error("claude CLI not found");
      }
      const online = await checkOnline();
      if (!online) {
        throw new Error("Anthropic API unreachable");
      }

      const isFollowUp = !!session.claudeSessionId && session.messages.length > 2;

      const claudeOpts = {
        prompt: cleanedPrompt,
        systemPrompt: isFollowUp ? undefined : FAMILIAR_SYSTEM_PREAMBLE,
        outputFormat: "json",
        disallowedTools: ENGIE_DISALLOWED_TOOLS,
        maxTurns: FAMILIAR_MAX_TURNS,
        addDirs: [resolve(PROJECT_DIR, "memory"), resolve(PROJECT_DIR, "workspace")],
        timeoutMs: FAMILIAR_TIMEOUT_MS,
        mcpConfig: FAMILIAR_MCP_CONFIG,
        resumeSession: isFollowUp ? session.claudeSessionId : undefined,
      };

      const result = await invokeClaude(claudeOpts, claudeLimiter);

      if (result.session_id) {
        session.claudeSessionId = result.session_id;
      }

      responseText = typeof result.result === "string" ? result.result : JSON.stringify(result.result);

      broadcast("agent", { runId, sessionKey, stream: "assistant", data: { delta: responseText } });

      // Collect training pair
      getCollector().then((c) => {
        if (c) c.collectPair({ prompt: message, routedTo: "claude", primaryResponse: responseText, primaryDurationMs: result.duration_ms });
      }).catch(() => {});

    } else {
      // ── 2. Route locally via classifier ──
      const routeResult = await router.route({
        prompt: message,
        hasCode: /```/.test(message),
      });

      const { role, model, systemPrompt, temperature, ollamaAvailable, backend } = routeResult;
      console.log(`[chat] session=${sessionKey.slice(0, 30)} role=${role} model=${model} backend=${backend} score=${routeResult.score?.toFixed(2)}`);

      // ── 3. If Ollama is down (e.g. during training), fall back to Claude ──
      if (backend === "claude" || !ollamaAvailable) {
        const online = await checkOnline();
        if (!online) {
          throw new Error("Both Ollama and Anthropic API unavailable — cannot process request.");
        }
        console.log(`[chat] Ollama unavailable, falling back to Claude`);
        const isFollowUp = !!session.claudeSessionId && session.messages.length > 2;
        const claudeOpts = {
          prompt: message,
          systemPrompt: isFollowUp ? undefined : FAMILIAR_SYSTEM_PREAMBLE,
          outputFormat: "json",
          maxTurns: FAMILIAR_MAX_TURNS,
          addDirs: [resolve(PROJECT_DIR, "memory"), resolve(PROJECT_DIR, "workspace")],
          timeoutMs: FAMILIAR_TIMEOUT_MS,
          mcpConfig: FAMILIAR_MCP_CONFIG,
          resumeSession: isFollowUp ? session.claudeSessionId : undefined,
        };
        const result = await invokeClaude(claudeOpts, claudeLimiter);
        if (result.session_id) session.claudeSessionId = result.session_id;
        responseText = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
        broadcast("agent", { runId, sessionKey, stream: "assistant", data: { delta: responseText } });

        session.messages.push({ role: "assistant", content: responseText, ts: Date.now() });
        broadcast("chat", { runId, sessionKey, state: "final", message: { role: "assistant", content: responseText } });
        return;
      }

      // ── 4. Inject memory context only for reasoning (coding/tools have their own system prompt, chat doesn't need it) ──
      const memoryCtx = role === "reasoning" ? buildMemoryContext() : "";
      const fullSystemPrompt = memoryCtx
        ? `${systemPrompt}\n\nBelow is background reference about projects and repos. Use it to inform your answers but do not summarize or repeat it.\n\n${memoryCtx}`
        : systemPrompt;

      // ── 5. Branch on role ──
      const responseStart = Date.now();
      let loopResult = null;

      if (role === "coding" || role === "tools") {
        // Tool loop for coding and tools — model gets tool schemas and can call them
        loopResult = await runToolLoop({
          prompt: message,
          systemPrompt: fullSystemPrompt,
          model,
          temperature,
          maxIterations: 10,
          maxToolCalls: 25,
          timeoutMs: 120_000,
        });

        responseText = loopResult.response || "(no response)";
        console.log(`[chat] ollama tool-loop done: role=${role} ${loopResult.iterations} iters, ${loopResult.toolCalls.length} tools, model=${model}`);
      } else {
        // Direct call for chat and reasoning — no tool loop, no nudging
        responseText = await callOllamaDirect({
          prompt: message,
          systemPrompt: fullSystemPrompt,
          model,
          temperature,
        });
        responseText = responseText || "(no response)";
        console.log(`[chat] ollama direct done: role=${role} model=${model}`);
      }

      // Validate response quality before broadcasting
      const validation = validateResponse({
        text: responseText,
        prompt: message,
        role,
        finishReason: loopResult?.finishReason || "complete",
        toolCalls: loopResult?.toolCalls || [],
      });

      if (!validation.pass) {
        console.warn(`[chat] response failed validation: ${validation.flags.join(", ")} (confidence: ${validation.confidence.toFixed(2)})`);
        responseText = "I couldn't generate a reliable response. Please try rephrasing or say 'use claude' for the heavy brain.";
      } else if (validation.confidence < 0.7) {
        console.warn(`[chat] low confidence response: ${validation.flags.join(", ")} (${validation.confidence.toFixed(2)})`);
        responseText = `[Low confidence] ${responseText}`;
      }

      // Fire Forge collector with actual response and model
      const responseDurationMs = Date.now() - responseStart;
      getCollector().then((c) => {
        if (c) c.collectPair({
          prompt: message,
          routedTo: "ollama",
          complexityScore: routeResult.score,
          primaryResponse: responseText,
          primaryModel: model,
          primaryDurationMs: responseDurationMs,
        });
      }).catch(() => {});

      broadcast("agent", { runId, sessionKey, stream: "assistant", data: { delta: responseText, quality: { pass: validation.pass, confidence: validation.confidence, flags: validation.flags } } });
    }

    // Store assistant message
    session.messages.push({ role: "assistant", content: responseText, ts: Date.now() });

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
console.log(`Familiar Gateway v1.1.0 (Single Brain Architecture)`);
console.log(`  listening:    ${hostname}:${PORT}`);
console.log(`  config:       ${configPath || "none"}`);
console.log(`  sessions TTL: ${SESSION_TTL_MS / 60000} min`);
console.log("");
console.log("Model routing (single brain, role-based dispatch):");
console.log("  coding/tools → familiar-brain:latest (tool loop)");
console.log("  chat/reason  → familiar-brain:latest (direct)");
console.log(`  claude → explicit trigger only (${bin ? "available" : "NOT FOUND"})`);
console.log("");
console.log("Claude trigger phrases: ask claude, @claude, use claude, hey claude");
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
