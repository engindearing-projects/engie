#!/usr/bin/env bun

// CozyTerm CLI — subcommand router
// Usage:
//   cozy                  Interactive TUI (chat)
//   cozy "question"       One-shot query
//   cozy init             Setup wizard
//   cozy status           Service health table
//   cozy doctor           Diagnostics & self-healing
//   cozy web              Open web UI (auto-authenticated)
//   cozy start            Start all services
//   cozy stop             Stop all services
//   cozy -h, --help       Show help

import chalk from "chalk";

const VERSION = "0.5.0";

const HELP = `
  ${chalk.bold("cozy")} v${VERSION} — AI project manager CLI (powered by Engie)

  ${chalk.cyan("Usage:")}
    cozy                      Interactive chat (TUI)
    cozy "your question"      One-shot query
    cozy init                 Setup wizard
    cozy status               Service health
    cozy doctor [--fix]       Diagnostics
    cozy web [port]           Open web UI (auto-authenticated)
    cozy start                Start all services
    cozy stop                 Stop all services
    cozy observe [type] <text> [--project p] [--tag t]
                              Save an observation to memory

  ${chalk.cyan("Options:")}
    -s, --session <key>   Session key (default: agent:engie:main)
    --coach               Start with coaching mode enabled
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
    /coach                     Toggle coaching mode
    /explain [concept]         Friendly explanation
    /suggest                   Get next-step suggestions
    /mobile                    Mobile access setup (Mosh/SSH)
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
  let sessionKey = "agent:engie:main";
  const sessionIdx = args.findIndex((a) => a === "--session" || a === "-s");
  if (sessionIdx !== -1) {
    sessionKey = args[sessionIdx + 1] || sessionKey;
    args.splice(sessionIdx, 2);
  }

  // Extract --coach flag
  let coach = false;
  const coachIdx = args.indexOf("--coach");
  if (coachIdx !== -1) {
    coach = true;
    args.splice(coachIdx, 1);
  }

  // Route to subcommand or chat
  const sub = args[0];

  if (!sub || (!SUBCOMMANDS.has(sub) && !sub.startsWith("-"))) {
    // No subcommand = chat mode
    // If there are args that aren't flags, treat as one-shot
    const oneshot = args.length > 0 ? args.join(" ") : null;
    const { run } = await import("../commands/chat.mjs");
    return run({ oneshot, sessionKey, coach });
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
