import { useCallback } from "react";
import { searchMemory, addObservation } from "./useMemory.js";

let sysMsgCounter = 0;

function sysMsg(text) {
  return { id: `sys-${++sysMsgCounter}`, role: "system", text };
}

const HELP_TEXT = [
  "Available commands:",
  "  /help              Show this help",
  "  /clear             Clear message history",
  "  /session           Show current session key",
  "  /status            Show service health",
  "  /memory [query]    Search memory (no query = show recent)",
  "  /observe <text>    Save an observation to memory",
  "  /forge [cmd]       Training pipeline (status, train, eval, data)",
  "  /coach             Toggle coaching mode",
  "  /explain [concept] Get a friendly explanation",
  "  /suggest           Get next-step suggestions",
  "  /mobile            Show mobile access setup",
  "  /quit              Exit (/exit, /q also work)",
].join("\n");

/**
 * Format a list of observations into a readable system message.
 */
function formatObservations(rows, label = "Recent memory") {
  if (!rows || rows.length === 0) {
    return `${label}: (empty)`;
  }
  const lines = rows.map((r) => {
    const ts = new Date(r.timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const project = r.project ? ` [${r.project}]` : "";
    const type = r.type ? ` (${r.type})` : "";
    return `  ${ts}${project}${type} — ${r.summary}`;
  });
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Slash command handler hook.
 *
 * Returns { handleCommand(text) -> bool } — returns true if the input was a slash command.
 */
export function useSlashCommands({ gateway, app, setMessages, setStreamText, sendMessage, sessionKey, services, coachMode, setCoachMode }) {
  const handleCommand = useCallback(
    async (text) => {
      const trimmed = text.trim();
      const lower = trimmed.toLowerCase();

      if (!trimmed.startsWith("/")) return false;

      // /quit, /exit, /q
      if (lower === "/quit" || lower === "/exit" || lower === "/q") {
        gateway.disconnect();
        app.exit();
        return true;
      }

      // /clear
      if (lower === "/clear") {
        setMessages([]);
        setStreamText("");
        return true;
      }

      // /session
      if (lower === "/session") {
        setMessages((prev) => [...prev, sysMsg(`Session: ${sessionKey}`)]);
        return true;
      }

      // /help
      if (lower === "/help") {
        setMessages((prev) => [...prev, sysMsg(HELP_TEXT)]);
        return true;
      }

      // /coach — toggle coaching mode
      if (lower === "/coach") {
        const newMode = !coachMode;
        setCoachMode(newMode);
        setMessages((prev) => [
          ...prev,
          sysMsg(newMode
            ? "Coaching mode ON — Engie will give warmer explanations with suggestions."
            : "Coaching mode OFF — back to standard mode."
          ),
        ]);
        return true;
      }

      // /explain [concept] — request a friendly explanation
      if (lower === "/explain" || lower.startsWith("/explain ")) {
        const concept = trimmed.slice("/explain".length).trim();
        if (!concept) {
          setMessages((prev) => [...prev, sysMsg("Usage: /explain <concept or command>")]);
          return true;
        }
        const wrapped =
          `[Coaching mode: explain this in a warm, friendly way. Use plain language first, then show the technical details. Use analogies where helpful. End with SUGGESTIONS: ["cmd1", "cmd2", ...]]\n\nExplain: ${concept}`;
        sendMessage(wrapped);
        return true;
      }

      // /suggest — request contextual next-step suggestions
      if (lower === "/suggest") {
        const wrapped =
          `[Based on our conversation so far, suggest 3-5 useful next steps or commands I could try. Format your response with SUGGESTIONS: ["cmd1", "cmd2", ...] at the end.]`;
        sendMessage(wrapped);
        return true;
      }

      // /status
      if (lower === "/status") {
        const lines = services.map((s) => {
          const dot = s.healthy ? "\u25CF" : "\u25CB";
          const status = s.healthy ? "healthy" : "down";
          return `  ${dot} ${s.name}: ${status}`;
        });
        setMessages((prev) => [
          ...prev,
          sysMsg(`Service health:\n${lines.join("\n")}`),
        ]);
        return true;
      }

      // /memory [query]
      if (lower === "/memory" || lower.startsWith("/memory ")) {
        const query = trimmed.slice("/memory".length).trim();

        // Optimistic loading message
        const loadingId = `sys-${++sysMsgCounter}`;
        setMessages((prev) => [
          ...prev,
          { id: loadingId, role: "system", text: query ? `Searching memory for: "${query}"...` : "Loading recent memory..." },
        ]);

        try {
          let rows;
          if (query) {
            rows = await searchMemory(query, { limit: 10 });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === loadingId
                  ? sysMsg(formatObservations(rows, `Memory search: "${query}"`))
                  : m
              )
            );
          } else {
            // Load recent without FTS
            const mem = await import("../../lib/memory-db.js").catch(() => null);
            if (mem) {
              const db = mem.getDb();
              rows = db
                .prepare(
                  `SELECT id, type, timestamp, project, summary, tags
                   FROM observations
                   ORDER BY timestamp DESC
                   LIMIT 10`
                )
                .all()
                .map((r) => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] }));
            } else {
              rows = [];
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === loadingId ? sysMsg(formatObservations(rows, "Recent memory")) : m
              )
            );
          }
        } catch (err) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === loadingId
                ? sysMsg(`Memory error: ${err.message}`)
                : m
            )
          );
        }

        return true;
      }

      // /observe <text>
      if (lower.startsWith("/observe ")) {
        const observeText = trimmed.slice("/observe ".length).trim();
        if (!observeText) {
          setMessages((prev) => [...prev, sysMsg("Usage: /observe <summary text>")]);
          return true;
        }

        try {
          const id = await addObservation({
            type: "note",
            summary: observeText,
            source: "cli",
          });
          setMessages((prev) => [...prev, sysMsg(`Saved observation: ${id}`)]);
        } catch (err) {
          setMessages((prev) => [...prev, sysMsg(`Failed to save: ${err.message}`)]);
        }

        return true;
      }

      // /forge [cmd]
      if (lower === "/forge" || lower.startsWith("/forge ")) {
        const forgeArgs = trimmed.slice("/forge".length).trim();
        const forgeCmd = forgeArgs || "status";
        setMessages((prev) => [
          ...prev,
          sysMsg(`Running forge ${forgeCmd}...`),
        ]);

        try {
          const forgeCli = await import("../../../trainer/forge-cli.mjs").catch(() => null);
          if (forgeCli) {
            // Capture console output
            const origLog = console.log;
            let output = [];
            console.log = (...args) => output.push(args.join(" "));
            try {
              await forgeCli.run({ args: forgeCmd.split(/\s+/) });
            } finally {
              console.log = origLog;
            }
            setMessages((prev) => [
              ...prev,
              sysMsg(output.join("\n") || "Done."),
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              sysMsg("Forge not available. Run: bash ~/engie/trainer/setup.sh"),
            ]);
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            sysMsg(`Forge error: ${err.message}`),
          ]);
        }
        return true;
      }

      // /mobile — show mobile access instructions
      if (lower === "/mobile") {
        const hostname = require("os").hostname();
        const mobileText = [
          "Mobile access via Mosh/SSH:",
          "",
          "1. Start a tmux session on this Mac:",
          `   bash ~/engie/scripts/start-tui-session.sh`,
          "",
          "2. From iPhone (Blink Shell or similar):",
          `   mosh ${hostname} -- tmux attach -t cozyterm`,
          "",
          "3. Or via plain SSH:",
          `   ssh ${hostname} -t 'tmux attach -t cozyterm'`,
          "",
          "Tips:",
          "  - Mosh handles spotty connections better than SSH",
          "  - Blink Shell (iOS) has native Mosh support",
          "  - The tmux session persists even if you disconnect",
        ].join("\n");
        setMessages((prev) => [...prev, sysMsg(mobileText)]);
        return true;
      }

      // Unknown slash command
      setMessages((prev) => [
        ...prev,
        sysMsg(`Unknown command: ${trimmed}. Type /help for available commands.`),
      ]);
      return true;
    },
    [gateway, app, setMessages, setStreamText, sendMessage, sessionKey, services, coachMode, setCoachMode]
  );

  return { handleCommand };
}
