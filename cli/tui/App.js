import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { Banner } from "./components/Banner.js";
import { MessageHistory } from "./components/MessageHistory.js";
import { StreamingMessage } from "./components/StreamingMessage.js";
import { ActivityTree } from "./components/ActivityTree.js";
import { SuggestionChips } from "./components/SuggestionChips.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputPrompt } from "./components/InputPrompt.js";
import { useGateway } from "./hooks/useGateway.js";
import { useInputHistory } from "./hooks/useInputHistory.js";
import { useSlashCommands } from "./hooks/useSlashCommands.js";
import { useServiceHealth } from "./hooks/useServiceHealth.js";
import { useFileActivity } from "./hooks/useFileActivity.js";
import { createStatusCycler } from "./lib/dynamic-status.js";

const e = React.createElement;

export function App({ gateway, sessionKey, initialCoachMode = false }) {
  const app = useApp();
  const [coachMode, setCoachMode] = useState(initialCoachMode);
  const [dynamicStatus, setDynamicStatus] = useState(null);

  const { messages, setMessages, streamText, setStreamText, busy, connected, error, sendMessage, suggestions, setSuggestions, toolStage, toolEvents, lastMeta } =
    useGateway(gateway, sessionKey, coachMode);

  const { services } = useServiceHealth(connected);

  // File activity tracking (fs.watch + gateway tool events)
  const { files, summary, isCollapsed } = useFileActivity({ busy, toolEvents, watchRoot: process.cwd() });

  // Dynamic status messages from local Ollama
  const statusCyclerRef = useRef(createStatusCycler());
  const lastQueryRef = useRef("");

  useEffect(() => {
    const cycler = statusCyclerRef.current;
    if (busy && lastQueryRef.current) {
      cycler.start(lastQueryRef.current);
    }
    if (!busy) {
      cycler.stop();
      setDynamicStatus(null);
    }
  }, [busy]);

  // Poll the cycler for current message while busy
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      const msg = statusCyclerRef.current.current();
      setDynamicStatus(msg);
    }, 500);
    return () => clearInterval(id);
  }, [busy]);

  const { handleCommand } = useSlashCommands({
    gateway,
    app,
    setMessages,
    setStreamText,
    sendMessage,
    sessionKey,
    services,
    coachMode,
    setCoachMode,
  });

  const handleSuggestionSelect = useCallback(
    (text) => {
      setSuggestions([]);
      setValue(text);
    },
    [setSuggestions]
  );

  const handleSubmit = useCallback(
    async (text) => {
      setSuggestions([]);
      lastQueryRef.current = text;
      const handled = await handleCommand(text);
      if (handled) return;
      sendMessage(text);
    },
    [handleCommand, sendMessage, setSuggestions]
  );

  const { value, setValue, onSubmit, handleKey } = useInputHistory(handleSubmit);

  // Arrow key history navigation
  useInput(handleKey);

  return e(Box, { flexDirection: "column" },
    e(Banner, { files, summary, isCollapsed }),
    e(MessageHistory, { messages }),
    e(ActivityTree, { files, busy, isCollapsed, summary }),
    e(StreamingMessage, { text: streamText, busy, toolStage, dynamicStatus }),
    e(SuggestionChips, { suggestions, onSelect: handleSuggestionSelect }),
    e(ErrorBanner, { error }),
    e(StatusBar, { services, session: sessionKey, lastMeta }),
    e(InputPrompt, {
      value,
      onChange: setValue,
      onSubmit,
      disabled: busy,
    })
  );
}
