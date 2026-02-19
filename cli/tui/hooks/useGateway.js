import { useState, useEffect, useCallback, useRef } from "react";
import { extractAndStore } from "../../lib/extract-observations.js";
import { injectContext } from "../../lib/memory-context.js";

const ACTIVITY_URL = `http://localhost:${process.env.ACTIVITY_PORT || 18790}`;

function logActivityQuiet(role, content, sessionKey = "agent:engie:cli") {
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
 * Returns { messages, streamText, busy, connected, error, sendMessage }
 *
 * - messages: completed message pairs [{id, role, text}]
 * - streamText: current in-progress assistant text (or "")
 * - busy: whether a request is in flight
 * - connected: gateway connection state
 * - error: last error message (or null)
 * - sendMessage(text): send a user message
 */
export function useGateway(gw, sessionKey) {
  const [messages, setMessages] = useState([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(gw?.connected ?? false);
  const [error, setError] = useState(null);

  // Track accumulated text for delta diffing (same approach as repl.mjs)
  const accumulatedRef = useRef("");
  const lastUserMsgRef = useRef("");

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
        }
        return;
      }

      // Assistant text stream
      if (stream === "assistant") {
        const fullText = data.text || data.content || "";
        const delta = data.delta || "";
        if (!fullText && !delta) return;

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
          setMessages((prev) => [
            ...prev,
            { id: `a-${++msgCounter}`, role: "assistant", text: finalText },
          ]);
        }

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
        setError(null);
      }

      if (payload.state === "error") {
        setError(payload.errorMessage || "Unknown error");
        setStreamText("");
        accumulatedRef.current = "";
        setBusy(false);
      }
    }

    function onDisconnected() {
      setConnected(false);
      setError("Lost connection to Engie gateway");
      setBusy(false);
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
      lastUserMsgRef.current = text;

      // Add user message to history (show raw text, not context-injected)
      setMessages((prev) => [
        ...prev,
        { id: `u-${++msgCounter}`, role: "user", text },
      ]);

      try {
        // Inject recent memory context as prefix — fails silently if DB unavailable
        const messageWithContext = await injectContext(text);
        await gw.chat(sessionKey, messageWithContext);
        // Response arrives via agent/chat events
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    },
    [gw, sessionKey, busy]
  );

  return { messages, setMessages, streamText, setStreamText, busy, connected, error, sendMessage };
}
