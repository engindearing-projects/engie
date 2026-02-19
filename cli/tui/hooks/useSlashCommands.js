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
export function useSlashCommands({ gateway, app, setMessages, setStreamText, sendMessage, sessionKey, services }) {
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
          { id: loadingId, role: "system", text: query ? `Searching memory for: "${query}"…` : "Loading recent memory…" },
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

      // Unknown slash command
      setMessages((prev) => [
        ...prev,
        sysMsg(`Unknown command: ${trimmed}. Type /help for available commands.`),
      ]);
      return true;
    },
    [gateway, app, setMessages, setStreamText, sendMessage, sessionKey, services]
  );

  return { handleCommand };
}
