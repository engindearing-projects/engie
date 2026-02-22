#!/usr/bin/env python3
"""
The Forge — LoRA Training
Runs MLX LoRA fine-tuning on prepared data using Qwen2.5-Coder-7B-Instruct as base.

Usage:
    python scripts/train.py [--iters 500] [--batch-size 4] [--lr 1e-5]
"""

import json
import os
import sys
import time
import argparse
import subprocess
import tempfile
from pathlib import Path

TRAINER_DIR = Path(__file__).resolve().parent.parent
BASE_MODEL = TRAINER_DIR / "models" / "base" / "Qwen2.5-Coder-7B-Instruct-4bit"
ADAPTERS_DIR = TRAINER_DIR / "models" / "adapters"
DATA_DIR = TRAINER_DIR / "data"
TRAIN_FILE = DATA_DIR / "train.jsonl"
VALID_FILE = DATA_DIR / "valid.jsonl"


def get_next_version():
    """Determine next version number from existing adapters."""
    if not ADAPTERS_DIR.exists():
        ADAPTERS_DIR.mkdir(parents=True)
        return 1

    versions = []
    for d in ADAPTERS_DIR.iterdir():
        if d.is_dir() and d.name.startswith("v"):
            try:
                versions.append(int(d.name[1:]))
            except ValueError:
                continue
    return max(versions, default=0) + 1


def get_previous_adapter(version):
    """Get the adapter path from the previous version (for resume)."""
    prev = version - 1
    if prev < 1:
        return None
    prev_path = ADAPTERS_DIR / f"v{prev}" / "adapters.safetensors"
    if prev_path.exists():
        return str(prev_path)
    return None


def count_lines(filepath):
    """Count lines in a file."""
    with open(filepath) as f:
        return sum(1 for _ in f)


def main():
    parser = argparse.ArgumentParser(description="Run LoRA training on prepared data")
    parser.add_argument("--iters", type=int, default=600, help="Training iterations (default: 600)")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size (default: 1)")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate (default: 1e-5)")
    parser.add_argument("--num-layers", type=int, default=16, help="LoRA layers (default: 16)")
    parser.add_argument("--lora-rank", type=int, default=16, help="LoRA rank (default: 16)")
    parser.add_argument("--lora-alpha", type=float, default=32, help="LoRA alpha (default: 32, typically 2x rank)")
    parser.add_argument("--max-seq-length", type=int, default=8192, help="Max sequence length (default: 8192)")
    parser.add_argument("--no-mask-prompt", action="store_true", help="Disable prompt masking (default: mask enabled)")
    parser.add_argument("--no-resume", action="store_true", help="Don't resume from previous adapter (use for rank changes)")
    parser.add_argument("--version", type=int, default=None, help="Override version number")
    args = parser.parse_args()

    # Validate inputs
    if not BASE_MODEL.exists():
        print(f"Base model not found at {BASE_MODEL}")
        print("Run setup.sh first to download the model.")
        sys.exit(1)

    if not TRAIN_FILE.exists():
        print(f"Training data not found at {TRAIN_FILE}")
        print("Run prepare-data.py first.")
        sys.exit(1)

    train_count = count_lines(TRAIN_FILE)
    valid_count = count_lines(VALID_FILE) if VALID_FILE.exists() else 0

    version = args.version or get_next_version()
    adapter_path = ADAPTERS_DIR / f"v{version}"
    adapter_path.mkdir(parents=True, exist_ok=True)

    print(f"=== The Forge — Training v{version} ===")
    print(f"  Base model:   {BASE_MODEL}")
    print(f"  Train data:   {train_count} examples")
    print(f"  Valid data:   {valid_count} examples")
    print(f"  Iterations:   {args.iters}")
    print(f"  Batch size:   {args.batch_size}")
    print(f"  Learning rate: {args.lr}")
    print(f"  LoRA layers:  {args.num_layers}")
    print(f"  LoRA rank:    {args.lora_rank}")
    print(f"  LoRA alpha:   {args.lora_alpha}")
    print(f"  Max seq len:  {args.max_seq_length}")
    print(f"  Mask prompt:  {not args.no_mask_prompt}")
    print(f"  Adapter path: {adapter_path}")

    # Write LoRA config YAML — mlx-lm reads rank/alpha from config file
    lora_config = {
        "lora_parameters": {
            "rank": args.lora_rank,
            "alpha": args.lora_alpha,
            "dropout": 0.05,
            "scale": args.lora_alpha / args.lora_rank,
        }
    }
    config_path = adapter_path / "lora-config.yaml"
    import yaml_compat
    yaml_compat.write(config_path, lora_config)

    # Build mlx_lm.lora command
    cmd = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", str(BASE_MODEL),
        "--data", str(DATA_DIR),
        "--train",
        "--iters", str(args.iters),
        "--batch-size", str(args.batch_size),
        "--num-layers", str(args.num_layers),
        "--learning-rate", str(args.lr),
        "--adapter-path", str(adapter_path),
        "--max-seq-length", str(args.max_seq_length),
        "--grad-checkpoint",
        "--val-batches", "4",
        "--steps-per-eval", "50",
        "--steps-per-report", "10",
        "--save-every", "100",
        "-c", str(config_path),
    ]

    # Mask prompt tokens — only compute gradients on the assistant response.
    if not args.no_mask_prompt:
        cmd.append("--mask-prompt")

    # Resume from previous adapter if available (skip if rank changed)
    prev_adapter = None if args.no_resume else get_previous_adapter(version)
    if prev_adapter:
        cmd.extend(["--resume-adapter-file", prev_adapter])
        print(f"  Resuming from: {prev_adapter}")

    print(f"\nStarting training...")
    start = time.time()

    try:
        result = subprocess.run(
            cmd,
            cwd=str(TRAINER_DIR),
            check=True,
            text=True,
            capture_output=False,  # let output stream to terminal
        )
    except subprocess.CalledProcessError as e:
        duration = time.time() - start
        print(f"\nTraining FAILED after {duration:.1f}s")

        # Record failure in forge DB
        try:
            _record_run(version, train_count, valid_count, None, None, args.iters, duration, "failed")
        except Exception:
            pass

        sys.exit(1)

    duration = time.time() - start
    print(f"\nTraining completed in {duration:.1f}s")

    # Try to extract loss from adapter config
    train_loss = None
    valid_loss = None
    config_path = adapter_path / "adapter_config.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text())
            # MLX-LM stores training info in the adapter config
            train_loss = config.get("train_loss")
            valid_loss = config.get("val_loss")
        except Exception:
            pass

    # Record in forge DB
    try:
        _record_run(version, train_count, valid_count, train_loss, valid_loss, args.iters, duration, "completed")
    except Exception as e:
        print(f"Warning: Could not record run in DB: {e}")

    # Save training metadata
    meta = {
        "version": f"v{version}",
        "base_model": str(BASE_MODEL),
        "train_examples": train_count,
        "valid_examples": valid_count,
        "iterations": args.iters,
        "batch_size": args.batch_size,
        "learning_rate": args.lr,
        "num_layers": args.num_layers,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "max_seq_length": args.max_seq_length,
        "mask_prompt": not args.no_mask_prompt,
        "duration_seconds": round(duration, 1),
        "train_loss": train_loss,
        "valid_loss": valid_loss,
        "previous_adapter": prev_adapter,
    }
    meta_path = adapter_path / "training-meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"  Metadata saved to {meta_path}")

    print(f"\nAdapter saved at: {adapter_path}")
    print(f"Next: run evaluate.py, then fuse-and-deploy.py")


def _record_run(version, train_count, valid_count, train_loss, valid_loss, iters, duration, status):
    """Record training run in the forge SQLite DB via Bun subprocess."""
    # We use a small inline script since the DB is managed by Bun/bun:sqlite
    js = f"""
    import {{ startRun, completeRun, failRun, createVersion }} from "{TRAINER_DIR}/forge-db.js";
    const v = "v{version}";
    try {{ createVersion(v, {{ adapterPath: "{ADAPTERS_DIR}/v{version}" }}); }} catch {{}}
    startRun(v, {train_count}, {valid_count});
    if ("{status}" === "completed") {{
      completeRun(v, {{
        trainLoss: {train_loss if train_loss else 'null'},
        validLoss: {valid_loss if valid_loss else 'null'},
        iterations: {iters},
        durationSeconds: {round(duration, 1)},
      }});
    }} else {{
      failRun(v);
    }}
    """
    try:
        subprocess.run(["bun", "-e", js], capture_output=True, timeout=10)
    except Exception:
        pass  # non-fatal


if __name__ == "__main__":
    main()
