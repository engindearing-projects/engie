import { useState, useEffect, useCallback, useRef } from "react";
import { extractAndStore } from "../../lib/extract-observations.js";
import { extractSuggestions, stripSuggestions } from "../lib/extract-suggestions.js";

const ACTIVITY_URL = `http://localhost:${process.env.ACTIVITY_PORT || 18790}`;

function logActivityQuiet(role, content, sessionKey = "agent:engie:main") {
  fetch(`${ACTIVITY_URL}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "cli", session_key: sessionKey, role, content }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

let msgCounter = 0;

/**
 * Bridge: GatewayClient EventEmitter → React state.
 *
 * Returns { messages, streamText, busy, connected, error, sendMessage, toolStage, lastMeta }
 *
 * - messages: completed message pairs [{id, role, text}]
 * - streamText: current in-progress assistant text (or "")
 * - busy: whether a request is in flight
 * - connected: gateway connection state
 * - error: last error message (or null)
 * - sendMessage(text): send a user message
 * - toolStage: current tool name being executed (or null)
 * - lastMeta: { model, durationMs } from last response (or null)
 */
export function useGateway(gw, sessionKey, coachMode = false) {
  const [messages, setMessages] = useState([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(gw?.connected ?? false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [toolStage, setToolStage] = useState(null);
  const [toolEvents, setToolEvents] = useState([]);
  const [lastMeta, setLastMeta] = useState(null);

  // Track accumulated text for delta diffing (same approach as repl.mjs)
  const accumulatedRef = useRef("");
  const lastUserMsgRef = useRef("");
  const responseStartRef = useRef(null);

  // Subscribe to gateway events
  useEffect(() => {
    if (!gw) return;

    setConnected(gw.connected);

    function onAgent(payload) {
      if (payload.sessionKey !== sessionKey) return;

      const data = payload.data || {};
      const stream = payload.stream;

      // Lifecycle errors
      if (stream === "lifecycle") {
        if (data.phase === "error") {
          setError(data.message || "Agent error");
          setBusy(false);
          setToolStage(null);
        }
        return;
      }

      // Tool events — extract tool name for context-aware spinner + file activity
      if (stream === "tool" || data.tool || data.phase === "tool_start") {
        const toolName = data.name || data.tool || data.toolName || "";
        const filePath = data.input?.file_path || data.input?.path
          || data.tool?.input?.file_path || data.tool?.input?.path || null;
        const phase = data.phase || (toolName ? "tool_start" : "unknown");

        if (toolName) {
          setToolStage(toolName);
          setToolEvents((prev) => [...prev, { toolName, filePath, timestamp: Date.now(), phase }]);
        }
        if (data.phase === "tool_end" || data.phase === "tool_complete") {
          setToolStage(null);
        }
        return;
      }

      // Assistant text stream
      if (stream === "assistant") {
        const fullText = data.text || data.content || "";
        const delta = data.delta || "";
        if (!fullText && !delta) return;

        // Clear tool stage when text starts flowing
        setToolStage(null);

        // Compute new accumulated text (mirrors repl.mjs logic)
        let newAccumulated = accumulatedRef.current;
        if (delta && fullText) {
          newAccumulated = fullText;
        } else if (delta) {
          newAccumulated = accumulatedRef.current + delta;
        } else {
          newAccumulated = fullText;
        }

        accumulatedRef.current = newAccumulated;
        setStreamText(newAccumulated);
      }
    }

    function onChat(payload) {
      if (payload.sessionKey !== sessionKey) return;

      if (payload.state === "final") {
        // Extract final text — prefer streamed text, fall back to message content
        let finalText = accumulatedRef.current;

        if (!finalText && payload.message?.content) {
          const content = payload.message.content;
          if (typeof content === "string") {
            finalText = content;
          } else if (Array.isArray(content)) {
            finalText = content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n");
          }
        }

        if (finalText) {
          // Extract and strip suggestions before displaying
          const chips = extractSuggestions(finalText);
          const cleanText = chips.length > 0 ? stripSuggestions(finalText) : finalText;
          setSuggestions(chips);

          setMessages((prev) => [
            ...prev,
            { id: `a-${++msgCounter}`, role: "assistant", text: cleanText },
          ]);
        }

        // Extract response metadata (model + duration)
        const model = payload.message?.model || payload.data?.model || null;
        const durationMs = responseStartRef.current
          ? Date.now() - responseStartRef.current
          : null;
        setLastMeta({ model, durationMs });

        // Fire-and-forget observation extraction
        const userText = lastUserMsgRef.current;
        if (userText && finalText) {
          setTimeout(() => extractAndStore(userText, finalText, "tui"), 0);
          // Log both messages to activity server
          logActivityQuiet("user", userText);
          logActivityQuiet("assistant", finalText);
        }

        setStreamText("");
        accumulatedRef.current = "";
        setBusy(false);
        setToolStage(null);
        setError(null);
        responseStartRef.current = null;
      }

      if (payload.state === "error") {
        setError(payload.errorMessage || "Unknown error");
        setStreamText("");
        accumulatedRef.current = "";
        setBusy(false);
        setToolStage(null);
        responseStartRef.current = null;
      }
    }

    function onDisconnected() {
      setConnected(false);
      setError("Lost connection to gateway");
      setBusy(false);
      setToolStage(null);
    }

    function onError(err) {
      setError(err?.message || String(err));
    }

    gw.on("agent", onAgent);
    gw.on("chat", onChat);
    gw.on("disconnected", onDisconnected);
    gw.on("error", onError);

    return () => {
      gw.off("agent", onAgent);
      gw.off("chat", onChat);
      gw.off("disconnected", onDisconnected);
      gw.off("error", onError);
    };
  }, [gw, sessionKey]);

  const sendMessage = useCallback(
    async (text) => {
      if (!text || busy) return;

      setError(null);
      setBusy(true);
      accumulatedRef.current = "";
      setStreamText("");
      setSuggestions([]);
      setToolStage(null);
      setToolEvents([]);
      lastUserMsgRef.current = text;
      responseStartRef.current = Date.now();

      // Add user message to history (show raw text, not context-injected)
      setMessages((prev) => [
        ...prev,
        { id: `u-${++msgCounter}`, role: "user", text },
      ]);

      try {
        // Memory context is now injected server-side by the gateway (reasoning role only).
        // No client-side injection — keeps the raw message clean for accurate classification.
        let messageToSend = text;

        // Prepend coaching context when coaching mode is active
        if (coachMode) {
          messageToSend =
            "[Coaching mode ON. Be warm, patient, encouraging. Explain in plain language first, use analogies. End with SUGGESTIONS: [\"cmd1\", \"cmd2\", ...]]\n\n" +
            messageToSend;
        }

        await gw.chat(sessionKey, messageToSend);
        // Response arrives via agent/chat events
      } catch (err) {
        setError(err.message);
        setBusy(false);
        setToolStage(null);
        responseStartRef.current = null;
      }
    },
    [gw, sessionKey, busy]
  );

  return { messages, setMessages, streamText, setStreamText, busy, connected, error, sendMessage, suggestions, setSuggestions, toolStage, toolEvents, lastMeta };
}
