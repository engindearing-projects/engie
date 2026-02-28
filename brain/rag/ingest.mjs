#!/usr/bin/env bun

// RAG Ingestion Pipeline
// Sources: conversation traces, memory observations, project docs
// Chunks into ~512-token blocks, embeds via Ollama nomic-embed-text,
// stores in SQLite with vector embeddings as binary blobs.
//
// Run: bun brain/rag/ingest.mjs
// Daily cron: 5:30 AM after forge-mine (4 AM)

import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync } from "fs";
import { resolve, join, basename, extname } from "path";

const HOME = process.env.HOME || "/tmp";
const PROJECT_DIR = resolve(import.meta.dir, "../..");
const DB_PATH = resolve(import.meta.dir, "knowledge.db");
const OLLAMA_URL = "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";
const CHUNK_SIZE = 512;     // ~tokens (approx 4 chars/token = 2048 chars)
const CHUNK_OVERLAP = 50;   // ~tokens overlap between chunks
const CHAR_CHUNK = CHUNK_SIZE * 4;
const CHAR_OVERLAP = CHUNK_OVERLAP * 4;

// ── Database Setup ──────────────────────────────────────────────────────────

function getDb() {
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      embedding BLOB,
      source TEXT NOT NULL,
      source_file TEXT,
      date TEXT,
      tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
    CREATE INDEX IF NOT EXISTS idx_chunks_date ON chunks(date);

    CREATE TABLE IF NOT EXISTS ingest_state (
      source TEXT PRIMARY KEY,
      last_file TEXT,
      last_offset INTEGER DEFAULT 0,
      last_run TEXT
    );
  `);
  return db;
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embed failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  // Ollama returns { embeddings: [[...]] } for single input
  const vec = data.embeddings?.[0];
  if (!vec || vec.length === 0) throw new Error("Empty embedding returned");
  return new Float32Array(vec);
}

function vecToBlob(vec) {
  return Buffer.from(vec.buffer);
}

// ── Chunking ────────────────────────────────────────────────────────────────

function chunkText(text, meta = {}) {
  const chunks = [];
  let offset = 0;

  while (offset < text.length) {
    const end = Math.min(offset + CHAR_CHUNK, text.length);
    const chunk = text.slice(offset, end).trim();

    if (chunk.length > 50) {
      chunks.push({ text: chunk, ...meta });
    }

    offset += CHAR_CHUNK - CHAR_OVERLAP;
  }

  return chunks;
}

// ── Sources ─────────────────────────────────────────────────────────────────

function ingestTraces(db) {
  const tracesDir = resolve(PROJECT_DIR, "trainer/data/traces");
  if (!existsSync(tracesDir)) return [];

  const state = db.prepare("SELECT last_file FROM ingest_state WHERE source = 'traces'").get();
  const lastFile = state?.last_file || "";

  const files = readdirSync(tracesDir)
    .filter(f => f.endsWith(".jsonl") && f > lastFile)
    .sort();

  const chunks = [];
  let latestFile = lastFile;

  for (const file of files) {
    const content = readFileSync(join(tracesDir, file), "utf-8");
    const lines = content.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const prompt = record.prompt || "";
        const response = record.response || record.trace?.slice(-1)?.[0]?.content || "";
        const text = `Q: ${prompt}\nA: ${response}`;

        chunks.push(...chunkText(text, {
          source: "traces",
          source_file: file,
          date: record.timestamp?.slice(0, 10) || new Date().toISOString().slice(0, 10),
          tags: "conversation,trace",
        }));
      } catch { /* skip malformed lines */ }
    }

    latestFile = file;
  }

  if (latestFile > lastFile) {
    db.prepare("INSERT OR REPLACE INTO ingest_state (source, last_file, last_run) VALUES ('traces', ?, datetime('now'))").run(latestFile);
  }

  return chunks;
}

function ingestMemory(db) {
  // Import from CLI memory database
  const memoryDbPath = resolve(HOME, ".familiar/memory/memory.db");
  if (!existsSync(memoryDbPath)) return [];

  const state = db.prepare("SELECT last_offset FROM ingest_state WHERE source = 'memory'").get();
  const lastOffset = state?.last_offset || 0;

  const memDb = new Database(memoryDbPath, { readonly: true });
  const rows = memDb.prepare(
    "SELECT id, type, summary, details, project, tags, timestamp FROM observations WHERE id > ? ORDER BY id ASC LIMIT 500"
  ).all(lastOffset);
  memDb.close();

  const chunks = [];
  let maxId = lastOffset;

  for (const row of rows) {
    const text = [
      row.type ? `[${row.type}]` : "",
      row.project ? `Project: ${row.project}` : "",
      row.summary || "",
      row.details || "",
    ].filter(Boolean).join("\n");

    if (text.length > 30) {
      chunks.push(...chunkText(text, {
        source: "memory",
        source_file: `observation:${row.id}`,
        date: row.timestamp?.slice(0, 10),
        tags: [row.type, row.project, "memory"].filter(Boolean).join(","),
      }));
    }

    maxId = Math.max(maxId, row.id);
  }

  if (maxId > lastOffset) {
    db.prepare("INSERT OR REPLACE INTO ingest_state (source, last_offset, last_run) VALUES ('memory', ?, datetime('now'))").run(maxId);
  }

  return chunks;
}

function ingestDocs(db) {
  // Ingest markdown docs from the project
  const docsDir = resolve(PROJECT_DIR, "docs");
  const memoryDir = resolve(PROJECT_DIR, "memory");

  const chunks = [];

  for (const dir of [docsDir, memoryDir]) {
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir).filter(f => extname(f) === ".md");
    for (const file of files) {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      const content = readFileSync(filePath, "utf-8");

      chunks.push(...chunkText(content, {
        source: "docs",
        source_file: file,
        date: stat.mtime.toISOString().slice(0, 10),
        tags: "docs," + basename(file, ".md"),
      }));
    }
  }

  // Also ingest Claude memory files
  const claudeMemDir = resolve(HOME, ".claude/projects/-Users-grantjwylie/memory");
  if (existsSync(claudeMemDir)) {
    const files = readdirSync(claudeMemDir).filter(f => extname(f) === ".md");
    for (const file of files) {
      const content = readFileSync(join(claudeMemDir, file), "utf-8");
      chunks.push(...chunkText(content, {
        source: "claude-memory",
        source_file: file,
        date: new Date().toISOString().slice(0, 10),
        tags: "memory,claude," + basename(file, ".md"),
      }));
    }
  }

  return chunks;
}

// ── Main Pipeline ───────────────────────────────────────────────────────────

async function main() {
  console.log("[ingest] Starting RAG ingestion...");
  const db = getDb();

  // Collect chunks from all sources
  const allChunks = [
    ...ingestTraces(db),
    ...ingestMemory(db),
    ...ingestDocs(db),
  ];

  console.log(`[ingest] ${allChunks.length} chunks to embed`);

  if (allChunks.length === 0) {
    console.log("[ingest] Nothing new to ingest");
    db.close();
    return;
  }

  // Embed and store
  const insert = db.prepare(
    "INSERT INTO chunks (text, embedding, source, source_file, date, tags) VALUES (?, ?, ?, ?, ?, ?)"
  );

  let embedded = 0;
  let errors = 0;

  for (const chunk of allChunks) {
    try {
      const vec = await embed(chunk.text);
      insert.run(
        chunk.text,
        vecToBlob(vec),
        chunk.source,
        chunk.source_file || null,
        chunk.date || null,
        chunk.tags || null,
      );
      embedded++;

      if (embedded % 50 === 0) {
        console.log(`[ingest] Embedded ${embedded}/${allChunks.length}...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 3) console.error(`[ingest] Embed error: ${err.message}`);
    }
  }

  db.close();
  console.log(`[ingest] Done: ${embedded} embedded, ${errors} errors`);
}

main().catch(err => {
  console.error("[ingest] Fatal:", err.message);
  process.exit(1);
});
