#!/usr/bin/env bun

// Quick test suite for the production quality upgrade.
// Run: bun scripts/test-upgrades.mjs

import { McpClient } from "./mcp-client.mjs";
import { validateResponse } from "./response-validator.mjs";
import { getToolSchemaText, executeTool, warmDaemon } from "./tools.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_BIN = resolve(__dirname, "..", "daemon", "target", "release", "familiar-daemon");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
      passed++;
    } catch (err) {
      console.log(`  \x1b[31mFAIL\x1b[0m  ${name}: ${err.message}`);
      failed++;
    }
  })();
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

// ── Test 1: Response Validator ──────────────────────────────────────────────

console.log("\n== Response Validator ==\n");

await test("passes clean response", () => {
  const r = validateResponse({ text: "Here's the file contents:\n```js\nconst x = 1;\n```\nThe variable x is set to 1.", prompt: "read server.js", role: "coding" });
  assert(r.pass, `expected pass, got ${r.confidence}`);
  assert(r.flags.length === 0, `expected no flags, got ${r.flags}`);
});

await test("catches repetition loop", () => {
  const repeated = "The answer is 42. Let me check again. ".repeat(20);
  const r = validateResponse({ text: repeated, prompt: "what is the answer?", role: "chat" });
  assert(r.flags.includes("repetition_loop"), "should flag repetition_loop");
  assert(!r.pass, "should fail");
});

await test("catches empty response", () => {
  const r = validateResponse({ text: "ok", prompt: "refactor the auth module", role: "coding" });
  assert(r.flags.includes("empty_or_stub"), "should flag empty_or_stub");
});

await test("catches language drift", () => {
  const r = validateResponse({
    text: "La respuesta es que necesitas cambiar el archivo de configuracion para que funcione correctamente con el nuevo sistema",
    prompt: "how do I fix the config?",
    role: "chat",
  });
  assert(r.flags.includes("language_drift"), "should flag language_drift");
});

await test("catches tool avoidance", () => {
  const r = validateResponse({
    text: "You should run `ls ~/projects` to see the files. Here's what I think you'd find...",
    prompt: "list files in ~/projects",
    role: "coding",
    toolCalls: [],
  });
  assert(r.flags.includes("tool_avoidance"), "should flag tool_avoidance");
});

await test("catches timeout truncation", () => {
  const r = validateResponse({
    text: "I was working on reading the files but ran out of time...",
    prompt: "read all the configs",
    role: "tools",
    finishReason: "timeout",
    toolCalls: [{ name: "read_file", ok: true }],
  });
  assert(r.flags.includes("timeout_truncation"), "should flag timeout_truncation");
});

await test("catches error finish", () => {
  const r = validateResponse({ text: "Model error: connection refused", prompt: "hello", role: "chat", finishReason: "error" });
  assert(r.flags.includes("error_finish"), "should flag error_finish");
  assert(!r.pass, "should fail");
});

await test("passes normal chat response", () => {
  const r = validateResponse({ text: "Hey, I'm doing well. What are you working on today?", prompt: "hey how's it going", role: "chat" });
  assert(r.pass, "should pass");
  assert(r.confidence > 0.7, `confidence should be > 0.7, got ${r.confidence}`);
});

// ── Test 2: MCP Client + Daemon ─────────────────────────────────────────────

console.log("\n== MCP Client (Rust Daemon) ==\n");

await test("connects to daemon", async () => {
  const client = new McpClient({ command: DAEMON_BIN, args: [], env: { RUST_LOG: "warn" } });
  await client.connect();
  assert(client.connected, "should be connected");
  client.close();
});

await test("lists daemon tools", async () => {
  const client = new McpClient({ command: DAEMON_BIN, args: [], env: { RUST_LOG: "warn" } });
  await client.connect();
  const tools = await client.listTools();
  assert(tools.length > 30, `expected 30+ tools, got ${tools.length}`);
  const names = tools.map(t => t.name);
  assert(names.includes("system_info"), "should have system_info");
  assert(names.includes("screenshot_screen"), "should have screenshot_screen");
  assert(names.includes("clipboard_read"), "should have clipboard_read");
  assert(names.includes("window_list"), "should have window_list");
  console.log(`          (${tools.length} tools discovered)`);
  client.close();
});

await test("calls system_info", async () => {
  const client = new McpClient({ command: DAEMON_BIN, args: [], env: { RUST_LOG: "warn" } });
  await client.connect();
  const result = await client.callTool("system_info", {});
  const text = result.content?.map(c => c.text).join("\n") || "";
  assert(text.includes("cpu") || text.includes("memory") || text.includes("os"), `expected system info, got: ${text.slice(0, 100)}`);
  console.log(`          ${text.slice(0, 80).replace(/\n/g, " ")}...`);
  client.close();
});

await test("calls clipboard_read", async () => {
  const client = new McpClient({ command: DAEMON_BIN, args: [], env: { RUST_LOG: "warn" } });
  await client.connect();
  const result = await client.callTool("clipboard_read", {});
  // Just verify it doesn't crash — clipboard may be empty
  assert(result.content != null, "should return content array");
  client.close();
});

// ── Test 3: Tool Loop Integration ───────────────────────────────────────────

console.log("\n== Tool Loop Integration ==\n");

await test("warmDaemon connects", async () => {
  await warmDaemon();
});

await test("getToolSchemaText includes daemon tools", () => {
  const text = getToolSchemaText();
  assert(text.includes("Computer Tools"), "should have Computer Tools section");
  assert(text.includes("screenshot_screen") || text.includes("system_info"), "should list daemon tools");
});

await test("executeTool routes to daemon for system_info", async () => {
  const result = await executeTool("system_info", {});
  assert(result.ok, `expected ok, got: ${result.result?.slice(0, 100)}`);
  assert(result.result.length > 20, "should have real system info");
  console.log(`          ${result.result.slice(0, 80).replace(/\n/g, " ")}...`);
});

await test("executeTool routes to daemon for window_list", async () => {
  const result = await executeTool("window_list", {});
  assert(result.ok, `expected ok, got: ${result.result?.slice(0, 100)}`);
  console.log(`          ${result.result.slice(0, 80).replace(/\n/g, " ")}...`);
});

await test("executeTool still handles core tools", async () => {
  const result = await executeTool("bash", { command: "echo hello" }, { cwd: process.env.HOME });
  assert(result.ok, `bash should work: ${result.result}`);
  assert(result.result.includes("hello"), "should echo hello");
});

await test("executeTool rejects unknown tools", async () => {
  const result = await executeTool("totally_fake_tool_xyz", {});
  assert(!result.ok, "should fail for unknown tool");
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n== Results: ${passed} passed, ${failed} failed ==\n`);
process.exit(failed > 0 ? 1 : 0);
