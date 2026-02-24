#!/usr/bin/env bun
// Simple coding challenge benchmark: engie-coder vs claude vs codex

import { spawnSync } from "child_process";
import { readFileSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const OLLAMA_URL = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || "http://localhost:11434";
const ENGIE_MODEL = process.env.ENGIE_MODEL || "engie-coder:latest";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const DUMP_ON_FAIL = process.env.BENCHMARK_DUMP === "1";
const DUMP_DIR = "/tmp/engie-bench-dump";

const TASKS = [
  {
    id: "palindrome",
    prompt:
      "Write a JavaScript function `isPalindrome(s)` that returns true if the string is a palindrome " +
      "considering only alphanumeric characters and ignoring case. Return a single JS function only.",
    tests: [
      ["A man, a plan, a canal: Panama", true],
      ["race a car", false],
      ["", true],
      ["0P", false],
    ],
  },
  {
    id: "two-sum",
    prompt:
      "Write a JavaScript function `twoSum(nums, target)` that returns indices of the two numbers " +
      "such that they add up to target. Assume exactly one solution, do not use the same element twice. " +
      "Return a single JS function only.",
    tests: [
      [[2, 7, 11, 15], 9, [0, 1]],
      [[3, 2, 4], 6, [1, 2]],
      [[3, 3], 6, [0, 1]],
    ],
  },
  {
    id: "valid-parens",
    prompt:
      "Write a JavaScript function `isValid(s)` that returns true if the string of brackets is valid. " +
      "Valid means brackets close in the correct order. Only characters are ()[]{}. Return a single JS function only.",
    tests: [
      ["()", true],
      ["()[]{}", true],
      ["(]", false],
      ["([)]", false],
      ["{[]}", true],
    ],
  },
  {
    id: "merge-intervals",
    prompt:
      "Write a JavaScript function `merge(intervals)` that merges all overlapping intervals and returns an array " +
      "of non-overlapping intervals sorted by start. Input is array of [start,end]. Return a single JS function only.",
    tests: [
      [[[1, 3], [2, 6], [8, 10], [15, 18]], [[1, 6], [8, 10], [15, 18]]],
      [[[1, 4], [4, 5]], [[1, 5]]],
    ],
  },
  {
    id: "group-anagrams",
    prompt:
      "Write a JavaScript function `groupAnagrams(strs)` that groups anagrams together. " +
      "Return array of groups in any order. Return a single JS function only.",
    tests: [
      [["eat", "tea", "tan", "ate", "nat", "bat"], [["bat"], ["nat", "tan"], ["ate", "eat", "tea"]]],
    ],
  },
  {
    id: "lru-cache",
    prompt:
      "Implement an LRUCache class in JavaScript with constructor `LRUCache(capacity)` and methods `get(key)` and `put(key, value)`. " +
      "get returns value or -1. Use O(1) operations. Return only the class definition.",
    tests: [
      [["put", 1, 1], ["put", 2, 2], ["get", 1, 1], ["put", 3, 3], ["get", 2, -1], ["put", 4, 4], ["get", 1, -1], ["get", 3, 3], ["get", 4, 4]],
    ],
  },
  {
    id: "top-k-frequent",
    prompt:
      "Write a JavaScript function `topKFrequent(nums, k)` that returns the k most frequent elements. " +
      "Return any order. Return a single JS function only.",
    tests: [
      [[1, 1, 1, 2, 2, 3], 2, [1, 2]],
    ],
  },
  {
    id: "binary-search",
    prompt:
      "Write a JavaScript function `binarySearch(nums, target)` that returns the index of target in a sorted array, or -1 if not found. " +
      "Return a single JS function only.",
    tests: [
      [[-1, 0, 3, 5, 9, 12], 9, 4],
      [[-1, 0, 3, 5, 9, 12], 2, -1],
    ],
  },
];

function commandExists(cmd) {
  const res = spawnSync("/usr/bin/which", [cmd], { encoding: "utf8" });
  return res.status === 0;
}

async function ollamaChat(prompt) {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ENGIE_MODEL,
      messages: [
        { role: "system", content: "Return only the JavaScript function." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || "");
}

function claudeRun(prompt) {
  if (!commandExists("claude")) return { error: "claude not found" };
  const res = spawnSync(
    "claude",
    [
      "-p",
      "--no-session-persistence",
      "--model",
      CLAUDE_MODEL,
      "--output-format",
      "text",
      "--append-system-prompt",
      "Return only the JavaScript function.",
      prompt,
    ],
    { encoding: "utf8", timeout: 240000, maxBuffer: 5_000_000 }
  );
  if (res.status !== 0) return { error: res.stderr || res.stdout || "claude failed" };
  return { text: res.stdout.trim() };
}

function codexRun(prompt) {
  if (!commandExists("codex")) return { error: "codex not found" };
  const strictPrompt = `${prompt}\n\nReturn ONLY the JavaScript function. No markdown. No commentary.`;
  const outFile = join(tmpdir(), `codex-last-${randomUUID()}.txt`);
  const res = spawnSync(
    "codex",
    ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--output-last-message", outFile, "-"],
    { encoding: "utf8", input: strictPrompt, timeout: 240000, maxBuffer: 5_000_000 }
  );
  if (res.status !== 0) return { error: res.stderr || res.stdout || "codex failed" };
  try {
    const text = readFileSync(outFile, "utf8").trim();
    unlinkSync(outFile);
    if (!text) return { error: "codex output empty" };
    return { text };
  } catch (e) {
    return { error: `codex output read failed: ${e.message}` };
  }
}

function sanitizeCode(text) {
  if (!text) return "";
  let out = text.trim();
  // If output looks JSON-escaped (contains lots of \\n), unescape.
  if (/\\\\n/.test(out) && !/\n/.test(out)) {
    out = out.replace(/\\\\n/g, "\n").replace(/\\\\t/g, "\t");
  }
  // Drop common leading chatter.
  out = out.replace(/^[^`]*?(?=function|const|let|var)/s, "");
  return out.trim();
}

function balanceBraces(text) {
  let open = 0;
  for (const ch of text) {
    if (ch === "{") open++;
    else if (ch === "}") open--;
  }
  if (open >= 0) return text;
  // Too many closing braces: trim from end until balanced
  let trimmed = text;
  while (open < 0 && trimmed.endsWith("}")) {
    trimmed = trimmed.slice(0, -1).trimEnd();
    open++;
  }
  return trimmed;
}

function extractFunction(text, fnName) {
  if (!text) return "";
  const fence = text.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  text = balanceBraces(sanitizeCode(text));

  // If the full text already defines the target symbol, keep it intact.
  if (fnName && new RegExp(`\\bclass\\s+${fnName}\\b`).test(text)) return text;
  if (fnName && new RegExp(`\\bfunction\\s+${fnName}\\b`).test(text)) return text;
  if (fnName && new RegExp(`\\bconst\\s+${fnName}\\b`).test(text)) return text;
  if (fnName && new RegExp(`\\blet\\s+${fnName}\\b`).test(text)) return text;
  if (fnName && new RegExp(`\\bvar\\s+${fnName}\\b`).test(text)) return text;

  // If this looks like a class body without the class declaration, wrap it.
  if (fnName && /constructor\s*\(/.test(text) && !/class\s+\w+/.test(text)) {
    return balanceBraces(`class ${fnName} {\n${text}\n}`);
  }

  const classMatch = text.match(/(class\s+\w+\s*[\s\S]*\n\})/);
  if (classMatch) return balanceBraces(sanitizeCode(classMatch[1].trim()));
  const funcMatch = text.match(/(function\s+\w+\s*\([\s\S]*\})/);
  if (funcMatch) return balanceBraces(sanitizeCode(funcMatch[1].trim()));
  const arrowMatch = text.match(/(const\s+\w+\s*=\s*\([\s\S]*?\)\s*=>[\s\S]*?;)/);
  if (arrowMatch) return balanceBraces(sanitizeCode(arrowMatch[1].trim()));
  const constMatch = text.match(/(const\s+\w+\s*=\s*\([\s\S]*\};?)/);
  if (constMatch) return balanceBraces(sanitizeCode(constMatch[1].trim()));
  const moduleExport = text.match(/module\.exports\s*=\s*([\s\S]*?);/);
  if (moduleExport) return balanceBraces(sanitizeCode(moduleExport[1].trim()));
  return balanceBraces(sanitizeCode(text.trim()));
}

function runTests(fnSource, task) {
  try {
    const wrapped = `${fnSource}\nreturn ${task.fnName};`;
    const exported = new Function(wrapped)();
    const fn = task.isClass ? exported : exported;
    if (task.isClass && typeof fn !== "function") {
      return { pass: 0, total: task.tests.length, ok: false, error: "Class not found" };
    }
    if (!task.isClass && typeof fn !== "function") {
      return { pass: 0, total: task.tests.length, ok: false, error: "Function not found" };
    }
    let pass = 0;
    for (const t of task.tests) {
      let ok = false;
      if (task.id === "two-sum") {
        const [nums, target, expected] = t;
        const res = fn(nums, target);
        ok = Array.isArray(res) && res.length === 2 && res[0] === expected[0] && res[1] === expected[1];
      } else if (task.id === "merge-intervals") {
        const [intervals, expected] = t;
        const res = fn(intervals);
        ok = JSON.stringify(res) === JSON.stringify(expected);
      } else if (task.id === "group-anagrams") {
        const [strs, expected] = t;
        const res = fn(strs);
        const norm = (groups) =>
          groups.map((g) => g.slice().sort()).sort((a, b) => a[0].localeCompare(b[0]));
        ok = JSON.stringify(norm(res)) === JSON.stringify(norm(expected));
      } else if (task.id === "lru-cache") {
        const ops = t;
        const cache = new fn(2);
        ok = true;
        for (const op of ops) {
          if (op[0] === "put") cache.put(op[1], op[2]);
          if (op[0] === "get") {
            const got = cache.get(op[1]);
            if (got !== op[2]) ok = false;
          }
        }
      } else if (task.id === "top-k-frequent") {
        const [nums, k, expected] = t;
        const res = fn(nums, k);
        if (!Array.isArray(res)) {
          return { pass: 0, total: task.tests.length, ok: false, error: "Return not array" };
        }
        const norm = (arr) => arr.slice().sort((a, b) => a - b);
        ok = JSON.stringify(norm(res)) === JSON.stringify(norm(expected));
      } else if (task.id === "binary-search") {
        const [nums, target, expected] = t;
        ok = fn(nums, target) === expected;
      } else {
        const [input, expected] = t;
        ok = fn(input) === expected;
      }
      if (ok) pass++;
    }
    return { pass, total: task.tests.length, ok: pass === task.tests.length };
  } catch (e) {
    return { pass: 0, total: task.tests.length, ok: false, error: e.message };
  }
}

function taskMeta(task) {
  if (task.id === "palindrome") return { fnName: "isPalindrome" };
  if (task.id === "two-sum") return { fnName: "twoSum" };
  if (task.id === "valid-parens") return { fnName: "isValid" };
  if (task.id === "merge-intervals") return { fnName: "merge" };
  if (task.id === "group-anagrams") return { fnName: "groupAnagrams" };
  if (task.id === "lru-cache") return { fnName: "LRUCache", isClass: true };
  if (task.id === "top-k-frequent") return { fnName: "topKFrequent" };
  if (task.id === "binary-search") return { fnName: "binarySearch" };
  return { fnName: "fn" };
}

async function main() {
  const results = [];
  if (DUMP_ON_FAIL) {
    try { mkdirSync(DUMP_DIR, { recursive: true }); } catch {}
  }

  for (const baseTask of TASKS) {
    const meta = taskMeta(baseTask);
    const task = { ...baseTask, ...meta };

    const engieText = await ollamaChat(task.prompt);
    const claude = claudeRun(task.prompt);
    const codex = codexRun(task.prompt);

    const engieFn = extractFunction(engieText, task.fnName);
    const claudeFn = extractFunction(claude.text || "", task.fnName);
    const codexFn = extractFunction(codex.text || "", task.fnName);

    const engieRes = runTests(engieFn, task);
    const claudeRes = claude.error ? { ok: false, error: claude.error } : runTests(claudeFn, task);
    const codexRes = codex.error ? { ok: false, error: codex.error } : runTests(codexFn, task);

    if (DUMP_ON_FAIL && (!engieRes.ok || !claudeRes.ok || !codexRes.ok)) {
      writeFileSync(join(DUMP_DIR, `${task.id}.engie.js`), engieFn || "");
      writeFileSync(join(DUMP_DIR, `${task.id}.claude.js`), claudeFn || "");
      writeFileSync(join(DUMP_DIR, `${task.id}.codex.js`), codexFn || "");
    }

    results.push({
      task: task.id,
      engie: engieRes,
      claude: claudeRes,
      codex: codexRes,
    });
  }

  console.log("Benchmark Results:");
  for (const r of results) {
    const fmt = (x) => (x.ok ? `${x.pass}/${x.total}` : `FAIL (${x.error || "tests failed"})`);
    console.log(`- ${r.task}: engie=${fmt(r.engie)} | claude=${fmt(r.claude)} | codex=${fmt(r.codex)}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
