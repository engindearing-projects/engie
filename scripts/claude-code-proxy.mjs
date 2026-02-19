#!/usr/bin/env bun

// Claude Code Proxy Server
// Wraps the `claude` CLI in headless mode (-p) behind an HTTP API
// so CozyTerm (OpenClaw) can invoke it for heavy-brain tasks.
//
// Runs on the HOST (not in Docker) because `claude` authenticates
// via the local subscription/keychain.
//
// Usage:
//   node scripts/claude-code-proxy.mjs
//   CLAUDE_PROXY_PORT=18791 node scripts/claude-code-proxy.mjs

import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");

const PORT = parseInt(process.env.CLAUDE_PROXY_PORT || "18791", 10);
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const MAX_TIMEOUT_MS = 600_000; // 10 min
const DEFAULT_MODEL = process.env.CLAUDE_PROXY_MODEL || "sonnet";

// ── CozyTerm-specific constants ──────────────────────────────────────────────

/** Tools that would create circular calls back through the gateway/proxy */
const ENGIE_DISALLOWED_TOOLS = [
  "mcp__engie__engie_chat",
  "mcp__engie__engie_claude",
];

const ENGIE_MAX_TURNS = 25;
const ENGIE_TIMEOUT_MS = 300_000; // 5 min — coding tasks need room
const ENGIE_MCP_CONFIG = resolve(PROJECT_DIR, "config", "mcp-tools.json");

/** System preamble prepended to whatever OpenClaw sends */
const ENGIE_SYSTEM_PREAMBLE = [
  "You are Engie, an AI project manager and coding assistant.",
  "You have read/write access to local memory files in ~/.cozyterm/memory/.",
  "You have full access to the filesystem, Bash, and all standard Claude Code tools.",
  "You have MCP tools for Jira (Atlassian), Slack, and Figma.",
  "",
  "Guidelines:",
  "- For Jira: use the mcp__atlassian__jira_* tools to look up tickets, sprints, boards, and update issues.",
  "- For Slack: use the mcp__slack__slack_* tools to read channels, post messages, and reply to threads.",
  "- For Figma: use the mcp__figma__* tools to get design screenshots, metadata, and design context.",
  "- For coding tasks: read files, edit code, run builds/tests, commit with git — use the full tool suite.",
  "- For GitHub: use the `gh` CLI tool.",
  "- Be concise and factual. Summarize results clearly.",
  "- If a tool call fails, mention the error briefly and try an alternative approach.",
  "- Never fabricate ticket numbers, statuses, or data — only report what tools return.",
].join("\n");

// ── State ────────────────────────────────────────────────────────────────────

const activeJobs = new Map(); // jobId -> { process, startedAt, prompt }
let onlineStatus = null; // cached: { online: bool, checkedAt: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function claudeBin() {
  try {
    const bin = execSync("which claude", { stdio: "pipe", env: cleanEnv() })
      .toString()
      .trim();
    return bin || null;
  } catch {
    return null;
  }
}

/** Build a clean env for claude subprocess — strip all Claude Code session vars */
function cleanEnv() {
  const env = { ...process.env };
  // Remove all vars that trigger nesting detection or session conflicts
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRY;
  delete env.CLAUDE_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION;
  // Remove any CLAUDECODE_* prefixed vars
  for (const key of Object.keys(env)) {
    if (key.startsWith("CLAUDECODE")) delete env[key];
  }
  return env;
}

// Strip our own env on startup so checks like claudeBin() work too
for (const key of Object.keys(process.env)) {
  if (key.startsWith("CLAUDECODE") || key === "CLAUDE_CODE_ENTRY" || key === "CLAUDE_CODE_SESSION") {
    delete process.env[key];
  }
}

async function checkOnline() {
  // Cache for 60s
  if (onlineStatus && Date.now() - onlineStatus.checkedAt < 60_000) {
    return onlineStatus.online;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch("https://api.anthropic.com", {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    onlineStatus = { online: true, checkedAt: Date.now() };
    return true;
  } catch {
    onlineStatus = { online: false, checkedAt: Date.now() };
    return false;
  }
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ── Claude CLI invocation ────────────────────────────────────────────────────

function invokeClaude(opts) {
  const {
    prompt,
    model = DEFAULT_MODEL,
    workingDir,
    systemPrompt,
    allowedTools,
    disallowedTools,
    maxTurns,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    outputFormat = "json",
    continueSession,
    resumeSession,
    addDirs,
    permissionMode,
    noSessionPersistence,
    mcpConfig,
    strictMcpConfig,
  } = opts;

  const jobId = randomUUID();

  return new Promise((resolveJob, rejectJob) => {
    const args = ["-p", prompt, "--output-format", outputFormat];

    if (model) args.push("--model", model);
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    if (maxTurns) args.push("--max-turns", String(maxTurns));
    if (continueSession) args.push("--continue");
    if (resumeSession) args.push("--resume", resumeSession);

    if (allowedTools && allowedTools.length > 0) {
      args.push("--allowedTools", ...allowedTools);
    }

    if (disallowedTools && disallowedTools.length > 0) {
      args.push("--disallowed-tools", ...disallowedTools);
    }

    if (permissionMode) {
      args.push("--permission-mode", permissionMode);
    }

    if (noSessionPersistence) {
      args.push("--no-session-persistence");
    }

    if (mcpConfig) {
      args.push("--mcp-config", mcpConfig);
    }

    if (strictMcpConfig) {
      args.push("--strict-mcp-config");
    }

    if (addDirs && addDirs.length > 0) {
      args.push("--add-dir", ...addDirs);
    }

    const cwd = workingDir || resolve(PROJECT_DIR, "workspace");

    const child = spawn("claude", args, {
      cwd,
      env: cleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeJobs.set(jobId, {
      process: child,
      startedAt: Date.now(),
      prompt: prompt.slice(0, 200),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      activeJobs.delete(jobId);
      rejectJob(new Error(`Timed out after ${timeoutMs}ms`));
    }, Math.min(timeoutMs, MAX_TIMEOUT_MS));

    child.on("close", (code) => {
      clearTimeout(timer);
      activeJobs.delete(jobId);

      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout);
          resolveJob({
            jobId,
            success: true,
            result: parsed.result || parsed,
            cost_usd: parsed.cost_usd,
            duration_ms: parsed.duration_ms,
            num_turns: parsed.num_turns,
            session_id: parsed.session_id,
            model: parsed.model,
          });
        } catch {
          resolveJob({
            jobId,
            success: true,
            result: stdout.trim(),
            raw: true,
          });
        }
      } else {
        rejectJob(
          new Error(
            `claude exited with code ${code}${stderr ? ": " + stderr.trim() : ""}`
          )
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      activeJobs.delete(jobId);
      rejectJob(err);
    });
  });
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}`);

  // CORS headers for local use
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // ── GET /health ──────────────────────────────────────────────────────────
  if (url.pathname === "/health" && req.method === "GET") {
    const bin = claudeBin();
    const online = await checkOnline();
    return jsonResponse(res, 200, {
      status: "ok",
      claudeAvailable: !!bin,
      claudePath: bin,
      online,
      activeJobs: activeJobs.size,
      uptime: process.uptime(),
    });
  }

  // ── GET /status ──────────────────────────────────────────────────────────
  if (url.pathname === "/status" && req.method === "GET") {
    const online = await checkOnline();
    const jobs = [];
    for (const [id, job] of activeJobs) {
      jobs.push({
        jobId: id,
        startedAt: job.startedAt,
        runningMs: Date.now() - job.startedAt,
        prompt: job.prompt,
      });
    }
    return jsonResponse(res, 200, {
      online,
      activeJobs: jobs,
      defaultModel: DEFAULT_MODEL,
    });
  }

  // ── POST /invoke ─────────────────────────────────────────────────────────
  if (url.pathname === "/invoke" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, 400, { error: e.message });
    }

    if (!body.prompt) {
      return jsonResponse(res, 400, { error: "prompt is required" });
    }

    // Check if claude is available
    if (!claudeBin()) {
      return jsonResponse(res, 503, {
        error: "claude CLI not found on PATH",
        hint: "Install Claude Code: npm install -g @anthropic-ai/claude-code",
      });
    }

    // Check online status if caller wants to know
    const online = await checkOnline();
    if (!online && !body.allowOffline) {
      return jsonResponse(res, 503, {
        error: "Anthropic API unreachable",
        online: false,
        hint: "Set allowOffline: true to attempt anyway, or route to Ollama",
      });
    }

    try {
      const result = await invokeClaude({
        prompt: body.prompt,
        model: body.model,
        workingDir: body.workingDir,
        systemPrompt: body.systemPrompt,
        allowedTools: body.allowedTools,
        maxTurns: body.maxTurns,
        timeoutMs: body.timeoutMs,
        outputFormat: body.outputFormat,
        continueSession: body.continueSession,
        resumeSession: body.resumeSession,
        addDirs: body.addDirs,
      });
      return jsonResponse(res, 200, result);
    } catch (e) {
      return jsonResponse(res, 500, {
        error: e.message,
        jobFailed: true,
      });
    }
  }

  // ── POST /invoke/stream ──────────────────────────────────────────────────
  // Streaming variant — returns newline-delimited JSON chunks
  if (url.pathname === "/invoke/stream" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, 400, { error: e.message });
    }

    if (!body.prompt) {
      return jsonResponse(res, 400, { error: "prompt is required" });
    }

    if (!claudeBin()) {
      return jsonResponse(res, 503, { error: "claude CLI not found" });
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    });

    const cwd = body.workingDir || resolve(PROJECT_DIR, "workspace");
    const args = [
      "-p",
      body.prompt,
      "--output-format",
      "stream-json",
    ];

    if (body.model) args.push("--model", body.model);
    if (body.systemPrompt) args.push("--system-prompt", body.systemPrompt);
    if (body.maxTurns) args.push("--max-turns", String(body.maxTurns));
    if (body.allowedTools) args.push("--allowedTools", ...body.allowedTools);
    if (body.addDirs) args.push("--add-dir", ...body.addDirs);

    const child = spawn("claude", args, {
      cwd,
      env: cleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const jobId = randomUUID();
    activeJobs.set(jobId, {
      process: child,
      startedAt: Date.now(),
      prompt: body.prompt.slice(0, 200),
    });

    // Forward stream-json chunks to HTTP response
    child.stdout.on("data", (chunk) => {
      res.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      // Emit errors as JSON lines
      res.write(
        JSON.stringify({ type: "error", error: chunk.toString().trim() }) +
          "\n"
      );
    });

    const timeout = Math.min(
      body.timeoutMs || DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      res.write(JSON.stringify({ type: "error", error: "timeout" }) + "\n");
      res.end();
    }, timeout);

    child.on("close", () => {
      clearTimeout(timer);
      activeJobs.delete(jobId);
      res.end();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      activeJobs.delete(jobId);
      res.write(
        JSON.stringify({ type: "error", error: err.message }) + "\n"
      );
      res.end();
    });

    return;
  }

  // ── GET /v1/models ──────────────────────────────────────────────────────
  // OpenAI-compatible model listing
  if (url.pathname === "/v1/models" && req.method === "GET") {
    return jsonResponse(res, 200, {
      object: "list",
      data: [
        { id: "claude-subscription", object: "model", created: Date.now(), owned_by: "anthropic" },
      ],
    });
  }

  // ── POST /v1/chat/completions ─────────────────────────────────────────
  // OpenAI-compatible chat completions — routes through claude -p
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, 400, { error: { message: e.message, type: "invalid_request_error" } });
    }

    console.log(`  stream=${body.stream} model=${body.model} messages=${(body.messages||[]).length}`);

    const messages = body.messages || [];
    if (messages.length === 0) {
      return jsonResponse(res, 400, { error: { message: "messages is required", type: "invalid_request_error" } });
    }

    if (!claudeBin()) {
      return jsonResponse(res, 503, { error: { message: "claude CLI not found", type: "server_error" } });
    }

    const online = await checkOnline();
    if (!online) {
      return jsonResponse(res, 503, { error: { message: "Anthropic API unreachable", type: "server_error" } });
    }

    // Convert messages array to a single prompt for claude -p
    // msg.content can be a string OR an array of content blocks [{type:"text",text:"..."}]
    function flattenContent(content) {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
      return String(content);
    }

    // Extract system messages, then take only the last N non-system messages
    // to avoid E2BIG when OpenClaw sends full conversation history.
    // claude -p is stateless — it only needs recent context.
    const MAX_CONTEXT_MESSAGES = 20;

    let systemPrompt = ENGIE_SYSTEM_PREAMBLE;
    const nonSystemMessages = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt += "\n\n" + flattenContent(msg.content);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    // Keep only the last N messages for context
    const recentMessages = nonSystemMessages.slice(-MAX_CONTEXT_MESSAGES);

    const turns = [];
    for (const msg of recentMessages) {
      const text = flattenContent(msg.content);
      if (msg.role === "user") {
        turns.push(`User: ${text}`);
      } else if (msg.role === "assistant") {
        turns.push(`Assistant: ${text}`);
      }
    }
    const prompt = turns.join("\n\n");

    const stream = body.stream === true;
    const id = `chatcmpl-${randomUUID().slice(0, 8)}`;
    const created = Math.floor(Date.now() / 1000);

    // Both streaming and non-streaming use the same blocking invocation.
    // claude -p returns a single JSON result; for SSE mode we wrap it
    // as a single content chunk + [DONE].

    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        const result = await invokeClaude({
          prompt,
          systemPrompt: systemPrompt || undefined,
          outputFormat: "json",
          permissionMode: "bypassPermissions",
          disallowedTools: ENGIE_DISALLOWED_TOOLS,
          noSessionPersistence: true,
          maxTurns: ENGIE_MAX_TURNS,
          addDirs: [resolve(PROJECT_DIR, "memory"), resolve(PROJECT_DIR, "workspace")],
          timeoutMs: ENGIE_TIMEOUT_MS,
          mcpConfig: ENGIE_MCP_CONFIG,
        });

        const text = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
        const sseChunk = {
          id, object: "chat.completion.chunk", created,
          model: "claude-subscription",
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);

        const sseDone = {
          id, object: "chat.completion.chunk", created,
          model: "claude-subscription",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(sseDone)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (e) {
        const sseErr = {
          id, object: "chat.completion.chunk", created,
          model: "claude-subscription",
          choices: [{ index: 0, delta: { content: `Error: ${e.message}` }, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(sseErr)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
      return;
    }

    // Non-streaming mode
    try {
      const result = await invokeClaude({
        prompt,
        systemPrompt: systemPrompt || undefined,
        outputFormat: "json",
        permissionMode: "bypassPermissions",
        disallowedTools: ENGIE_DISALLOWED_TOOLS,
        noSessionPersistence: true,
        maxTurns: ENGIE_MAX_TURNS,
        addDirs: [resolve(PROJECT_DIR, "memory"), resolve(PROJECT_DIR, "workspace")],
        timeoutMs: ENGIE_TIMEOUT_MS,
        mcpConfig: ENGIE_MCP_CONFIG,
      });

      const text = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
      return jsonResponse(res, 200, {
        id: `chatcmpl-${randomUUID().slice(0, 8)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "claude-subscription",
        choices: [{
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (e) {
      return jsonResponse(res, 500, { error: { message: e.message, type: "server_error" } });
    }
  }

  // ── POST /cancel ─────────────────────────────────────────────────────────
  if (url.pathname === "/cancel" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return jsonResponse(res, 400, { error: e.message });
    }

    const job = activeJobs.get(body.jobId);
    if (!job) {
      return jsonResponse(res, 404, { error: "Job not found or already completed" });
    }

    job.process.kill("SIGTERM");
    activeJobs.delete(body.jobId);
    return jsonResponse(res, 200, { cancelled: true, jobId: body.jobId });
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  jsonResponse(res, 404, { error: "Not found" });
});

// ── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, "127.0.0.1", () => {
  const bin = claudeBin();
  console.log(`Claude Code Proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`  claude binary: ${bin || "NOT FOUND"}`);
  console.log(`  default model: ${DEFAULT_MODEL}`);
  console.log(`  workspace:     ${resolve(PROJECT_DIR, "workspace")}`);
  console.log("");
  console.log("Endpoints:");
  console.log("  GET  /health         — check proxy + claude + online status");
  console.log("  GET  /status         — active jobs and connectivity");
  console.log("  POST /invoke         — run claude -p (blocking, returns JSON)");
  console.log("  POST /invoke/stream  — run claude -p (streaming NDJSON)");
  console.log("  POST /cancel         — kill a running job by jobId");
});
