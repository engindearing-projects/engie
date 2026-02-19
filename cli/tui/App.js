import React, { useState, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import { Banner } from "./components/Banner.js";
import { MessageHistory } from "./components/MessageHistory.js";
import { StreamingMessage } from "./components/StreamingMessage.js";
import { SuggestionChips } from "./components/SuggestionChips.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputPrompt } from "./components/InputPrompt.js";
import { useGateway } from "./hooks/useGateway.js";
import { useInputHistory } from "./hooks/useInputHistory.js";
import { useSlashCommands } from "./hooks/useSlashCommands.js";
import { useServiceHealth } from "./hooks/useServiceHealth.js";

const e = React.createElement;

export function App({ gateway, sessionKey, initialCoachMode = false }) {
  const app = useApp();
  const [coachMode, setCoachMode] = useState(initialCoachMode);

  const { messages, setMessages, streamText, setStreamText, busy, connected, error, sendMessage, suggestions, setSuggestions } =
    useGateway(gateway, sessionKey, coachMode);

  const { services } = useServiceHealth(connected);

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
    e(Banner),
    e(MessageHistory, { messages }),
    e(StreamingMessage, { text: streamText, busy }),
    e(SuggestionChips, { suggestions, onSelect: handleSuggestionSelect }),
    e(ErrorBanner, { error }),
    e(StatusBar, { services, session: sessionKey }),
    e(InputPrompt, {
      value,
      onChange: setValue,
      onSubmit,
      disabled: busy,
    })
  );
}
