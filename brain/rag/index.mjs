#!/usr/bin/env bun

// RAG Query Module
// Searches the knowledge base using cosine similarity on embeddings.
//
// API:
//   import { search } from "./index.mjs";
//   const results = await search("patient portal", 5);
//
// CLI:
//   bun brain/rag/index.mjs "patient portal"

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { resolve } from "path";
import { queryGraph } from "./graph.mjs";

const DB_PATH = resolve(import.meta.dir, "knowledge.db");
const OLLAMA_URL = "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";

// ── Embedding ───────────────────────────────────────────────────────────────

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Embed failed: ${res.status}`);

  const data = await res.json();
  return new Float32Array(data.embeddings?.[0] || []);
}

// ── Vector Math ─────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function blobToVec(blob) {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Search the RAG knowledge base.
 *
 * @param {string} query - Search query text
 * @param {number} topK - Number of results to return (default 5)
 * @param {object} opts - Optional filters
 * @param {string} opts.source - Filter by source type (traces, memory, docs, claude-memory)
 * @param {number} opts.minScore - Minimum cosine similarity score (default 0.3)
 * @returns {Promise<Array<{text: string, score: number, source: string, date: string}>>}
 */
export async function search(query, topK = 5, opts = {}) {
  if (!existsSync(DB_PATH)) return [];

  const db = new Database(DB_PATH, { readonly: true });

  // Get all chunks with embeddings
  let sql = "SELECT id, text, embedding, source, source_file, date, tags FROM chunks WHERE embedding IS NOT NULL";
  const params = [];

  if (opts.source) {
    sql += " AND source = ?";
    params.push(opts.source);
  }

  const rows = db.prepare(sql).all(...params);
  db.close();

  if (rows.length === 0) return [];

  // Embed the query
  const queryVec = await embed(query);
  const minScore = opts.minScore ?? 0.3;

  // Score all chunks by vector similarity
  const vectorScored = rows
    .map(row => ({
      id: row.id,
      text: row.text,
      score: cosineSimilarity(queryVec, blobToVec(row.embedding)),
      source: row.source,
      source_file: row.source_file,
      date: row.date,
      tags: row.tags,
    }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  let results = vectorScored.slice(0, topK);

  // Graph-enhanced: pull in related chunks the vector search may have missed
  const useGraph = opts.graph !== false;
  if (useGraph) {
    const seenIds = new Set(results.map(r => r.id));
    const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);

    for (const term of terms) {
      try {
        const { chunks: gChunks } = await queryGraph(term, { topChunks: 3 });
        for (const gc of gChunks) {
          if (!seenIds.has(gc.id)) {
            seenIds.add(gc.id);
            results.push({
              id: gc.id,
              text: gc.text,
              score: 0.35,
              source: gc.source,
              source_file: null,
              date: gc.date,
              tags: gc.tags,
              via: "graph",
            });
          }
        }
      } catch { /* graph unavailable, continue with vector results */ }
    }

    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, topK);
  }

  return results;
}

/**
 * Get total chunk count and source breakdown.
 */
export function stats() {
  if (!existsSync(DB_PATH)) return { total: 0, sources: {} };

  const db = new Database(DB_PATH, { readonly: true });
  const total = db.prepare("SELECT COUNT(*) as count FROM chunks").get().count;
  const sources = {};
  for (const row of db.prepare("SELECT source, COUNT(*) as count FROM chunks GROUP BY source").all()) {
    sources[row.source] = row.count;
  }
  db.close();
  return { total, sources };
}

// ── CLI Mode ────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const query = process.argv[2];
  if (!query) {
    // Show stats
    const s = stats();
    console.log(`Knowledge base: ${s.total} chunks`);
    for (const [source, count] of Object.entries(s.sources)) {
      console.log(`  ${source}: ${count}`);
    }
    process.exit(0);
  }

  console.log(`Searching for: "${query}"\n`);
  const results = await search(query, 5);

  if (results.length === 0) {
    console.log("No results found.");
  } else {
    for (const r of results) {
      console.log(`[${r.score.toFixed(3)}] ${r.source} (${r.date || "?"})`);
      console.log(`  ${r.text.slice(0, 200).replace(/\n/g, " ")}...`);
      console.log();
    }
  }
}
