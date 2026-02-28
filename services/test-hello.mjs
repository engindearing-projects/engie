#!/usr/bin/env bun
// Quick test: send "hello" to gateway, print the response and which model handled it.

import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "..", "config", "cozyterm.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const GW_PORT = config.gateway?.port ?? 18789;
const GW_TOKEN = config.gateway?.auth?.token;
let reqId = 0;
const nextId = () => String(++reqId);

const ws = new WebSocket(`ws://localhost:${GW_PORT}`, {
  headers: { Origin: `http://localhost:${GW_PORT}` },
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "event" && msg.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: nextId(), method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "cozyterm-ui", version: "1.0.0", platform: "node", mode: "ui" },
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.pairing", "chat"],
        auth: { token: GW_TOKEN },
      },
    }));
    return;
  }

  if (msg.type === "res" && reqId === 1) {
    if (!msg.ok) {
      console.log("CONNECT FAIL:", JSON.stringify(msg));
      ws.close();
      return;
    }
    console.log("CONNECTED — sending: hello\n");
    ws.send(JSON.stringify({
      type: "req", id: nextId(), method: "chat.send",
      params: {
        sessionKey: `agent:engie:test-hello-${Date.now()}`,
        message: process.argv[2] || "hello",
        idempotencyKey: randomUUID(),
      },
    }));
    return;
  }

  if (msg.type === "event" && msg.event === "agent") {
    const delta = msg.payload?.data?.delta || "";
    console.log("=== AGENT RESPONSE ===");
    console.log(delta.slice(0, 2000));
    console.log("======================\n");
    return;
  }

  if (msg.type === "event" && msg.event === "chat") {
    if (msg.payload?.state === "final") {
      console.log("=== FINAL ===");
      console.log((msg.payload?.message?.content || "(empty)").slice(0, 2000));
      console.log("=============");
      setTimeout(() => { ws.close(); process.exit(0); }, 300);
    } else if (msg.payload?.state === "error") {
      console.log("=== ERROR ===");
      console.log(msg.payload?.error || msg.payload?.errorMessage);
      console.log("=============");
      setTimeout(() => { ws.close(); process.exit(1); }, 300);
    }
    return;
  }

  if (msg.type === "res") {
    // ack for chat.send — ignore
    return;
  }
});

ws.on("error", (e) => console.log("WS ERROR:", e.message));
setTimeout(() => { console.log("TIMEOUT (180s)"); ws.close(); process.exit(1); }, 180000);
