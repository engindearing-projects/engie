#!/usr/bin/env python3
"""
The Forge — Data Preparation
Reads raw JSONL pair files, filters, deduplicates, and splits into train/valid sets.
Outputs MLX chat format for LoRA training.

Usage:
    python scripts/prepare-data.py [--min-pairs 10]
"""

import json
import hashlib
import os
import sys
import argparse
from pathlib import Path
from collections import defaultdict
from domain_config import get_active_domain, load_domain

TRAINER_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = TRAINER_DIR / "data" / "raw"
TRACES_DIR = TRAINER_DIR / "data" / "traces"
TRAIN_FILE = TRAINER_DIR / "data" / "train.jsonl"
VALID_FILE = TRAINER_DIR / "data" / "valid.jsonl"

# Loaded from domain config in main()
DOMAIN = None
SYSTEM_PROMPT = None
MIN_RESPONSE_LENGTH = 50

# Hard filter patterns — Claude responses containing these are garbage for training
CLAUDE_REJECT_PATTERNS = [
    "permission",
    "Would you like me to proceed",
    "Would you like me to create",
    "I need your approval",
    "approve",
    "I'll create the following files",
    "Let me create",
    "I'll write",
    "permission_denials",
    "is_error",
    "tool_use_id",
]

# Minimum quality thresholds for v2
MIN_CLAUDE_LENGTH = 500          # Claude response must be substantial
MIN_CODE_BLOCKS = 1              # Must contain at least one code block
MAX_PERMISSION_RATIO = 0.3       # If >30% of response is about permissions, reject


def load_raw_pairs():
    """Load all raw JSONL pair files."""
    pairs = []
    if not RAW_DIR.exists():
        return pairs

    for f in sorted(RAW_DIR.glob("*.jsonl")):
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    pair = json.loads(line)
                    pairs.append(pair)
                except json.JSONDecodeError:
                    continue
    return pairs


def load_self_iterate_traces():
    """Load successful self-iterate traces as training examples.

    Self-iterate traces contain multi-turn conversations where the model
    iterates on code until tests pass. We extract the final successful
    attempt as a training example (prompt → correct code).
    """
    examples = []
    if not TRACES_DIR.exists():
        return examples

    for f in sorted(TRACES_DIR.glob("*-self-iterate.jsonl")):
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    # Only use successful iterations
                    if not record.get("success"):
                        continue
                    trace = record.get("trace", [])
                    if len(trace) < 2:
                        continue

                    # Extract: first user message = prompt, last assistant message = gold
                    prompt = None
                    last_assistant = None
                    for msg in trace:
                        if msg["role"] == "user" and prompt is None:
                            prompt = msg["content"]
                        if msg["role"] == "assistant":
                            last_assistant = msg["content"]

                    if prompt and last_assistant and len(last_assistant) >= MIN_RESPONSE_LENGTH:
                        examples.append({
                            "type": "self_iterate",
                            "prompt": prompt,
                            "gold_response": last_assistant,
                            "iterations": record.get("iterations", 1),
                            "task_id": record.get("task_id"),
                        })
                except json.JSONDecodeError:
                    continue
    return examples


def load_tool_traces():
    """Load tool-use traces from agent loop and Claude Code sessions.

    These teach the model the agent loop: when to call tools, how to
    interpret results, and how to chain tool calls. The full multi-turn
    trace is preserved for agent training.

    Loads both *-tools.jsonl (Claude Code) and *-agent.jsonl (engie-coder
    tool loop) trace files with metadata types: tool_use, agent_loop.
    """
    examples = []
    if not TRACES_DIR.exists():
        return examples

    # Match both tool trace formats
    trace_files = sorted(TRACES_DIR.glob("*-tools.jsonl")) + sorted(TRACES_DIR.glob("*-agent.jsonl"))
    accepted_types = {"tool_use", "agent_loop"}

    for f in trace_files:
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    trace = record.get("trace", [])
                    if len(trace) < 2:
                        continue
                    meta = record.get("metadata", {})
                    if meta.get("type") not in accepted_types:
                        continue

                    prompt = record.get("prompt", "")
                    if len(prompt) < 20:
                        continue

                    # For tool-use traces, we flatten the full conversation
                    # into a single assistant turn showing the reasoning + actions
                    full_response = ""
                    for msg in trace:
                        if msg["role"] == "assistant":
                            if msg.get("content"):
                                full_response += msg["content"] + "\n"
                            if msg.get("tool_calls"):
                                for tc in msg["tool_calls"]:
                                    fn = tc.get("function", {})
                                    full_response += f"\n[Tool: {fn.get('name')}({fn.get('arguments', '')})]\n"

                    if len(full_response) >= MIN_RESPONSE_LENGTH:
                        examples.append({
                            "type": "tool_trace",
                            "prompt": prompt,
                            "gold_response": full_response.strip(),
                            "tools_used": meta.get("tools_used", []),
                        })
                except json.JSONDecodeError:
                    continue
    return examples


def has_code_block(text):
    """Check if text contains a markdown code block."""
    return "```" in text


def is_ground_truth(pair):
    """Check if this pair has a real ground-truth diff."""
    return pair.get("type") == "ground_truth" and pair.get("ground_truth_diff")


def is_permission_garbage(text):
    """Check if Claude's response is mostly about asking for permissions."""
    if not text:
        return True
    text_lower = text.lower()
    hits = sum(1 for pat in CLAUDE_REJECT_PATTERNS if pat.lower() in text_lower)
    # If 3+ reject patterns match, it's permission-asking garbage
    if hits >= 3:
        return True
    # If response looks like raw JSON tool output (common with permission denials)
    if text.strip().startswith('{"type":') or text.strip().startswith('{"result":'):
        return True
    return False


def count_code_blocks(text):
    """Count fenced code blocks in text."""
    return text.count("```") // 2


def filter_pair(pair):
    """Return True if pair should be kept for training.

    v2 hard filters:
    - Reject permission-asking Claude responses
    - Reject responses without code blocks
    - Require minimum 500 chars from Claude
    - Reject raw JSON/tool output
    - Reject empty or near-empty responses
    """
    prompt = pair.get("prompt", "")

    # Prompt must be non-trivial
    if len(prompt) < 20:
        return False

    # Ground-truth pairs: use real diff as gold, only need the diff to be valid
    if is_ground_truth(pair):
        diff = pair.get("ground_truth_diff", "")
        # Ground truth must have actual code changes
        if len(diff) < 100:
            return False
        # Must look like a real diff
        if "+" not in diff and "-" not in diff:
            return False
        return True

    # Standard distillation pairs: use Claude response as gold
    claude = pair.get("claude_response", "")
    local = pair.get("local_response", "")

    # Both responses must exist
    if not claude or not local:
        return False

    # HARD FILTER: reject permission-asking garbage
    if is_permission_garbage(claude):
        return False

    # HARD FILTER: minimum length — Claude's gold response must be substantial
    if len(claude) < MIN_CLAUDE_LENGTH:
        return False

    # HARD FILTER: must contain actual code
    if not has_code_block(claude):
        return False

    # HARD FILTER: must have at least MIN_CODE_BLOCKS code blocks
    if count_code_blocks(claude) < MIN_CODE_BLOCKS:
        return False

    # Reject responses that are mostly error messages or tool output
    if '"is_error":true' in claude or '"stop_reason":null' in claude:
        return False

    return True


def prompt_hash(prompt):
    """Create a hash of the prompt for deduplication."""
    normalized = prompt.strip().lower()
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def to_chat_format(pair):
    """Convert a pair to MLX chat training format.

    Handles four data types:
    - Ground-truth: real merged PR diff as gold answer
    - Standard distillation: Claude's response as gold answer
    - Self-iterate: model's own corrected code (after iteration) as gold
    - Tool traces: Claude's full tool-use conversation as gold
    """
    pair_type = pair.get("type")

    if pair_type == "self_iterate":
        gold = pair["gold_response"]
    elif pair_type == "tool_trace":
        gold = pair["gold_response"]
    elif is_ground_truth(pair):
        diff = pair["ground_truth_diff"]
        gold = f"Here are the code changes:\n\n```diff\n{diff}\n```"
    else:
        gold = pair["claude_response"]

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": pair["prompt"]},
            {"role": "assistant", "content": gold},
        ]
    }


def main():
    global DOMAIN, SYSTEM_PROMPT, MIN_RESPONSE_LENGTH

    parser = argparse.ArgumentParser(description="Prepare training data from raw pairs")
    parser.add_argument("--min-pairs", type=int, default=10,
                        help="Minimum pairs needed to proceed (default: 10)")
    parser.add_argument("--split-ratio", type=float, default=0.9,
                        help="Train/valid split ratio (default: 0.9)")
    parser.add_argument("--domain", type=str, default=None,
                        help="Domain to use (default: active domain)")
    args = parser.parse_args()

    # Load domain config
    if args.domain:
        DOMAIN = load_domain(args.domain)
    else:
        DOMAIN = get_active_domain()
    SYSTEM_PROMPT = DOMAIN["system_prompt"]
    MIN_RESPONSE_LENGTH = DOMAIN.get("data", {}).get("min_response_length", 50)

    print(f"Domain: {DOMAIN['name']} ({DOMAIN['id']})")
    print(f"Loading raw pairs from {RAW_DIR}...")
    pairs = load_raw_pairs()
    print(f"  Loaded {len(pairs)} raw pairs")

    # Load self-iterate traces
    si_traces = load_self_iterate_traces()
    print(f"  Loaded {len(si_traces)} self-iterate traces (successful)")

    # Load tool-use traces
    tool_traces = load_tool_traces()
    print(f"  Loaded {len(tool_traces)} tool-use traces")

    # Merge all sources
    all_data = pairs + si_traces + tool_traces

    if len(all_data) == 0:
        print("No data found. Collect more data first.")
        sys.exit(1)

    # Filter (only standard pairs need filtering — traces are pre-filtered)
    filtered = []
    rejected_reasons = defaultdict(int)
    for p in all_data:
        if p.get("type") in ("self_iterate", "tool_trace"):
            filtered.append(p)
        elif filter_pair(p):
            filtered.append(p)
        else:
            # Track why pairs were rejected
            claude = p.get("claude_response", "")
            if is_ground_truth(p):
                rejected_reasons["gt_too_short"] += 1
            elif not claude or not p.get("local_response", ""):
                rejected_reasons["missing_response"] += 1
            elif is_permission_garbage(claude):
                rejected_reasons["permission_garbage"] += 1
            elif len(claude) < MIN_CLAUDE_LENGTH:
                rejected_reasons["too_short"] += 1
            elif not has_code_block(claude):
                rejected_reasons["no_code_blocks"] += 1
            else:
                rejected_reasons["other"] += 1

    rejected_total = len(all_data) - len(filtered)
    print(f"  After filtering: {len(filtered)} examples ({rejected_total} rejected)")
    if rejected_reasons:
        print(f"  Rejection breakdown:")
        for reason, count in sorted(rejected_reasons.items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}")

    # Deduplicate by prompt hash
    seen = set()
    deduped = []
    for p in filtered:
        h = prompt_hash(p["prompt"])
        if h not in seen:
            seen.add(h)
            deduped.append(p)
    print(f"  After dedup: {len(deduped)} unique examples")

    if len(deduped) < args.min_pairs:
        print(f"Not enough pairs ({len(deduped)} < {args.min_pairs}). Collect more data.")
        sys.exit(1)

    # Convert to chat format
    examples = [to_chat_format(p) for p in deduped]

    # Shuffle deterministically
    import random
    random.seed(42)
    random.shuffle(examples)

    # Split
    split_idx = int(len(examples) * args.split_ratio)
    train = examples[:split_idx]
    valid = examples[split_idx:]

    # Ensure at least 1 validation example
    if len(valid) == 0 and len(train) > 1:
        valid = [train.pop()]

    # Write output
    TRAIN_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(TRAIN_FILE, "w") as f:
        for ex in train:
            f.write(json.dumps(ex) + "\n")

    with open(VALID_FILE, "w") as f:
        for ex in valid:
            f.write(json.dumps(ex) + "\n")

    # MLX-LM expects test.jsonl to exist — write empty valid set or skip
    test_file = TRAINER_DIR / "data" / "test.jsonl"
    if not test_file.exists() or test_file.stat().st_size == 0:
        # Write a small test set (reuse last few valid examples)
        test = valid[:min(5, len(valid))]
        with open(test_file, "w") as f:
            for ex in test:
                f.write(json.dumps(ex) + "\n")

    print(f"\nOutput:")
    print(f"  Train: {len(train)} examples → {TRAIN_FILE}")
    print(f"  Valid: {len(valid)} examples → {VALID_FILE}")
    print(f"  Test:  {min(5, len(valid))} examples → {test_file}")
    print("Done.")


if __name__ == "__main__":
    main()
