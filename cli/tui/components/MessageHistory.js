import React from "react";
import { Static } from "ink";
import { UserMessage } from "./UserMessage.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { SystemMessage } from "./SystemMessage.js";

const e = React.createElement;

export function MessageHistory({ messages }) {
  return e(Static, { items: messages },
    (msg) => {
      if (msg.role === "user") {
        return e(UserMessage, { key: msg.id, text: msg.text });
      }
      if (msg.role === "system") {
        return e(SystemMessage, { key: msg.id, text: msg.text });
      }
      return e(AssistantMessage, { key: msg.id, text: msg.text });
    }
  );
}
