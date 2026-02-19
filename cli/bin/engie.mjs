#!/usr/bin/env bun

// Engie CLI — subcommand router
// Usage:
//   engie                  Interactive TUI (chat)
//   engie "question"       One-shot query
//   engie init             Setup wizard
//   engie status           Service health table
//   engie doctor           Diagnostics & self-healing
//   engie web              Open web UI (auto-authenticated)
//   engie start            Start all services
//   engie stop             Stop all services
//   engie -h, --help       Show help

import chalk from "chalk";

const VERSION = "0.3.0";

const HELP = `
  ${chalk.bold("engie")} v${VERSION} — AI project manager CLI

  ${chalk.cyan("Usage:")}
    engie                     Interactive chat (TUI)
    engie "your question"     One-shot query
    engie init                Setup wizard
    engie status              Service health
    engie doctor [--fix]      Diagnostics
    engie web [port]           Open web UI (auto-authenticated)
    engie start               Start all services
    engie stop                Stop all services
    engie observe [type] <text> [--project p] [--tag t]
                              Save an observation to memory

  ${chalk.cyan("Options:")}
    -s, --session <key>   Session key (default: agent:engie:cli)
    -h, --help            Show this help
    -v, --version         Show version

  ${chalk.cyan("Chat commands:")}
    /quit, /exit, /q           Exit
    /clear                     Clear screen
    /session                   Show session key
    /help                      Available commands
    /status                    Inline service health
    /memory [query]            Search memory DB
    /observe <text>            Save observation to memory
`;

// Subcommands that map to command modules
const SUBCOMMANDS = new Set(["init", "status", "doctor", "start", "stop", "observe", "web"]);

async function main() {
  const args = process.argv.slice(2);

  // Global flags
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Extract --session / -s before routing
  let sessionKey = "agent:engie:cli";
  const sessionIdx = args.findIndex((a) => a === "--session" || a === "-s");
  if (sessionIdx !== -1) {
    sessionKey = args[sessionIdx + 1] || sessionKey;
    args.splice(sessionIdx, 2);
  }

  // Route to subcommand or chat
  const sub = args[0];

  if (!sub || (!SUBCOMMANDS.has(sub) && !sub.startsWith("-"))) {
    // No subcommand = chat mode
    // If there are args that aren't flags, treat as one-shot
    const oneshot = args.length > 0 ? args.join(" ") : null;
    const { run } = await import("../commands/chat.mjs");
    return run({ oneshot, sessionKey });
  }

  // Pass remaining args to the subcommand
  const subArgs = args.slice(1);

  switch (sub) {
    case "init": {
      const { run } = await import("../commands/init.mjs");
      return run({ args: subArgs });
    }
    case "status": {
      const { run } = await import("../commands/status.mjs");
      return run({ args: subArgs });
    }
    case "doctor": {
      const { run } = await import("../commands/doctor.mjs");
      return run({ args: subArgs });
    }
    case "start": {
      const { run } = await import("../commands/start.mjs");
      return run({ args: subArgs });
    }
    case "stop": {
      const { run } = await import("../commands/stop.mjs");
      return run({ args: subArgs });
    }
    case "observe": {
      const { run } = await import("../commands/observe.mjs");
      return run({ args: subArgs });
    }
    case "web": {
      const { run } = await import("../commands/web.mjs");
      return run({ args: subArgs });
    }
    default:
      console.error(chalk.red(`Unknown command: ${sub}`));
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
