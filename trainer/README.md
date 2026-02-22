# The Forge

A self-improving AI training pipeline. Train domain-specific models by distilling knowledge from stronger models, then deploy them locally via Ollama.

## What It Does

The Forge captures prompt/response pairs from your daily AI usage, filters and prepares training data, fine-tunes a local model using LoRA adapters, evaluates against benchmarks, and deploys the improved model back to Ollama. Over time, the local model gets smarter and handles more tasks independently.

## Supported Domains

| Domain | Model Prefix | Description |
|--------|-------------|-------------|
| coding | engie-coder | Code generation, debugging, refactoring |
| legal | engie-legal | Contract drafting, compliance, legal research |
| healthcare | engie-health | Clinical docs, treatment protocols, patient comms |
| finance | engie-finance | Financial analysis, risk modeling, regulatory |
| education | engie-edu | Lesson plans, assessments, curriculum design |

## Requirements

- **macOS Apple Silicon** (M1/M2/M3/M4) — or Linux with NVIDIA GPU
- **Python 3.10+**
- **Bun** (JavaScript runtime)
- **Ollama** (local model serving)
- **~15GB free disk** for base model + adapters

## Quick Start

### 1. Run Setup

```bash
cd ~/engie
bun trainer/forge-cli.mjs init
```

This will:
- Detect your hardware (Apple Silicon MLX or NVIDIA CUDA)
- Create a Python virtual environment
- Install training dependencies (mlx-lm, transformers, etc.)
- Download the base model (Qwen2.5-Coder-7B-Instruct, ~4GB)
- Initialize the metrics database

To set up for a specific domain:

```bash
bun trainer/forge-cli.mjs init --domain healthcare
```

### 2. Collect Training Data

Training data comes from prompt/response pairs. There are several ways to collect data:

**Automatic collection** (if running the Engie proxy):
The collector intercepts prompts routed through the system and captures paired responses from both the cloud model and local model.

**Manual comparison** (generates a training pair):
```bash
bun trainer/forge-cli.mjs compare "Write a function to validate email addresses"
```

**Mine from GitHub PRs** (real-world code changes as ground truth):
```bash
bun trainer/forge-cli.mjs mine-gt --sources YourOrg --max-prs 10
```

**Expanded miner** (distillation from multiple sources):
```bash
bun trainer/forge-cli.mjs mine
```

### 3. Train the Model

When you have enough training pairs (50+ recommended), run the full pipeline:

```bash
bun trainer/forge-cli.mjs train
```

This runs four steps:
1. **Prepare** — Filters raw pairs, deduplicates, splits into train/validation sets
2. **Train** — Runs LoRA fine-tuning via MLX-LM (~10-30 minutes depending on data size)
3. **Deploy** — Fuses adapter with base model, converts to GGUF, creates Ollama model
4. **Evaluate** — Scores the new model against benchmark tasks

### 4. Check Status

```bash
bun trainer/forge-cli.mjs status
```

Shows: data collection stats, training run history, model versions, benchmark scores.

### 5. Evaluate the Model

Run benchmarks independently:

```bash
bun trainer/forge-cli.mjs eval
```

The evaluator scores each benchmark task on:
- **Structure** (25 pts) — Code syntax validity / document structure
- **Correctness** (40 pts) — Test passing / requirements coverage
- **Similarity** (20 pts) — Closeness to gold standard answer
- **Completeness** (15 pts) — Covers all requirements

### 6. Rollback (if needed)

If a new version regresses, revert to the previous one:

```bash
bun trainer/forge-cli.mjs rollback
```

## Serving the Model

Expose your trained model as an OpenAI-compatible API for other developers:

```bash
bun trainer/forge-cli.mjs serve
```

This starts an HTTP server on port 18793 with:
- `GET /health` — Status check
- `GET /v1/domains` — List available domains
- `GET /v1/models` — List Ollama models
- `POST /v1/chat/completions` — OpenAI-compatible chat endpoint

### Authentication

Set API keys via environment variable or file:

```bash
# Environment variable (comma-separated)
FORGE_API_KEYS=key1,key2 bun trainer/forge-cli.mjs serve

# Or create an api-keys.txt file (one key per line)
echo "your-secret-key" > trainer/api-keys.txt
bun trainer/forge-cli.mjs serve
```

### Connecting from any OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://your-machine:18793/v1",
    api_key="your-secret-key"
)

response = client.chat.completions.create(
    model="engie-coder:latest",
    messages=[{"role": "user", "content": "Write a fibonacci function"}]
)
print(response.choices[0].message.content)
```

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://your-machine:18793/v1",
  apiKey: "your-secret-key"
});

const response = await client.chat.completions.create({
  model: "engie-coder:latest",
  messages: [{ role: "user", content: "Write a fibonacci function" }]
});
console.log(response.choices[0].message.content);
```

## Switching Domains

List all domains:

```bash
bun trainer/forge-cli.mjs domain
```

Switch active domain:

```bash
bun trainer/forge-cli.mjs domain healthcare
```

Each domain has its own:
- System prompt tuned for the field
- Data filtering rules (min response length, code block requirements)
- Evaluation criteria and scoring weights
- Benchmark tasks
- Model prefix (e.g., `engie-health:latest`)

## Directory Structure

```
trainer/
  forge-cli.mjs          # Main CLI entry point
  forge-db.js            # SQLite metrics database
  collector.mjs          # Automatic data collection
  serve.mjs              # API server for external access
  domain-config.mjs      # Domain configuration loader
  self-iterate.mjs       # Self-improvement loop
  setup.sh               # Shell-based setup (alternative to init)

  domains/               # Domain configuration files
    coding.json
    legal.json
    healthcare.json
    finance.json
    education.json

  scripts/               # Python training pipeline
    prepare-data.py      # Filter + split raw data
    train.py             # MLX LoRA fine-tuning (Apple Silicon)
    train-cuda.py        # PyTorch QLoRA training (NVIDIA GPU)
    evaluate.py          # Benchmark scoring
    fuse-and-deploy.py   # Adapter → GGUF → Ollama
    setup-remote.sh      # Set up a remote Linux training server
    sync-remote.sh       # Sync data/models between Mac and remote

  data/
    raw/                 # Daily JSONL files of captured pairs
    traces/              # Self-iteration and tool-use traces
    train.jsonl          # Current training split (generated)
    valid.jsonl          # Current validation split (generated)

  models/
    base/                # Downloaded base model
    adapters/v1/, v2/    # LoRA adapters per version
    fused/               # Merged model checkpoints
    gguf/                # Converted GGUF files

  benchmarks/
    coding-tasks.jsonl   # Coding benchmark tasks
    legal-tasks.jsonl    # Legal benchmark tasks
    healthcare-tasks.jsonl
    finance-tasks.jsonl
    education-tasks.jsonl
    results/             # Per-version evaluation results

  db/forge.db            # SQLite metrics database
  logs/                  # Usage and training logs
```

## All CLI Commands

```
engie forge init [--domain id]     Set up The Forge
engie forge status                 Show training data, versions, scores
engie forge domain [id]            List or switch domains
engie forge train                  Full pipeline: prepare → train → eval → deploy
engie forge eval                   Run benchmark on current model
engie forge iterate                Self-iteration improvement loop
engie forge compare "prompt"       Side-by-side cloud vs local comparison
engie forge data                   Collection stats
engie forge mine                   Run expanded data miner
engie forge mine-gt                Run ground-truth miner (real PR diffs)
engie forge serve                  Start API server
engie forge auto [start|stop]      Manage auto-trainer daemon
engie forge rollback               Revert to previous version
```

## Training on a Remote Machine (NVIDIA GPU)

If you have a second machine with an NVIDIA GPU on your network, you can offload training for faster results. The Forge supports a Mac (data collection) + Linux PC (training) split.

### Initial Setup (on the remote PC)

```bash
# 1. Copy the trainer directory to the remote machine
scp -r ~/engie/trainer user@remote-ip:~/engie/trainer

# 2. SSH in and run setup
ssh user@remote-ip
cd ~/engie/trainer
bash scripts/setup-remote.sh
```

This installs PyTorch + CUDA, downloads the base model (~15GB), and sets up Ollama.

### Training Workflow

From your Mac, use the sync script to push data, train remotely, and pull results:

```bash
# Push training data to remote
bash trainer/scripts/sync-remote.sh push

# Full cycle: push → prepare → train → pull
bash trainer/scripts/sync-remote.sh full

# Check remote status
bash trainer/scripts/sync-remote.sh status

# Pull trained adapters/GGUFs back
bash trainer/scripts/sync-remote.sh pull
```

Or train manually on the remote:

```bash
ssh user@remote-ip
cd ~/engie/trainer

# Prepare data
.venv/bin/python scripts/prepare-data.py

# Train with CUDA (uses QLoRA — fits in 8GB VRAM)
.venv/bin/python scripts/train-cuda.py --epochs 3 --batch-size 2

# Convert to GGUF and deploy to Ollama
.venv/bin/python scripts/fuse-and-deploy.py
```

### Configure Remote Connection

Set environment variables or edit `scripts/sync-remote.sh`:

```bash
export FORGE_REMOTE_USER=j
export FORGE_REMOTE_HOST=192.168.0.50
export FORGE_REMOTE_DIR=~/engie/trainer
```

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU VRAM | 8GB (QLoRA) | 16GB+ (larger batch sizes) |
| System RAM | 32GB | 64GB |
| Disk | 50GB free | 100GB+ |
| CUDA | 11.8+ | 12.0+ |

## Adding a New Domain

1. Create a config file at `trainer/domains/your-domain.json`:
   ```json
   {
     "id": "your-domain",
     "name": "Your Domain Name",
     "description": "What this domain covers",
     "base_model": "Qwen2.5-Coder-7B-Instruct-4bit",
     "model_prefix": "engie-yourdomain",
     "system_prompt": "You are an expert in...",
     "data": {
       "min_response_length": 100,
       "require_code_blocks": false,
       "dedup_by_hash": true
     },
     "eval": {
       "has_executable_tests": false,
       "scoring": {
         "structure": { "weight": 25 },
         "correctness": { "weight": 40 },
         "similarity": { "weight": 20 },
         "completeness": { "weight": 15 }
       }
     },
     "training": {
       "iterations": 500,
       "batch_size": 4,
       "learning_rate": 1e-5,
       "num_layers": 16
     },
     "ollama": {
       "temperature": 0.7,
       "top_p": 0.9,
       "num_ctx": 8192
     }
   }
   ```

2. Create benchmark tasks at `trainer/benchmarks/your-domain-tasks.jsonl` (JSONL format, one task per line):
   ```json
   {"id": "task-1", "category": "general", "prompt": "Your task prompt", "requirements": ["keyword1", "keyword2"], "gold_answer": "The ideal response..."}
   ```

3. Switch to the new domain:
   ```bash
   bun trainer/forge-cli.mjs domain your-domain
   ```

4. Collect data and train as normal.
