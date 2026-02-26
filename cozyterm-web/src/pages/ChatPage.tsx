import { useEffect, useRef, useCallback, useState } from 'react';
import { colors } from '../theme/colors';
import { useGateway } from '../hooks/useGateway';
import { useActivitySync } from '../hooks/useActivitySync';
import { isOnboarded, setOnboarded } from '../services/store';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { MessageBubble } from '../components/MessageBubble';
import { StreamingIndicator } from '../components/StreamingIndicator';
import { RecapBanner } from '../components/RecapBanner';
import { ChatInput } from '../components/ChatInput';
import type { Message } from '../types/gateway';
import styles from './ChatPage.module.css';

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: "Hey, I'm Engie. Tell me a bit about yourself \u2014 what you work on, your role, how you'd like me to help. I'll remember it for next time.",
  timestamp: 0,
};

export default function ChatPage() {
  const { messages, streamText, busy, connectionState, error, sendMessage } = useGateway();
  const { unread, logActivity, markRead } = useActivitySync();

  const [onboarded, setOnboardedState] = useState(() => isOnboarded());
  const messageEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  // Auto-scroll to bottom when messages change or streaming updates
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  // Log new messages to activity server (fire-and-forget)
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const newMsgs = messages.slice(prevMsgCountRef.current);
      for (const msg of newMsgs) {
        logActivity(msg.role, msg.text);
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, logActivity]);

  const handleSend = useCallback(
    (text: string) => {
      if (!onboarded) {
        setOnboarded();
        setOnboardedState(true);
      }
      sendMessage(text);
    },
    [onboarded, sendMessage],
  );

  // Build the display messages list, prepending the welcome message if not yet onboarded
  const displayMessages = onboarded ? messages : [WELCOME_MESSAGE, ...messages];

  const isDisconnected = connectionState === 'disconnected';

  return (
    <div className={styles.page} style={{ backgroundColor: colors.bg }}>
      {/* Header */}
      <div className={styles.header} style={{ borderBottom: `1px solid ${colors.bgLighter}` }}>
        <span className={styles.title} style={{ color: colors.cyan }}>
          Engie
        </span>
        <ConnectionBadge state={connectionState} />
      </div>

      {/* Recap banner */}
      {unread && (
        <RecapBanner
          unread={unread}
          onDismiss={() => {
            const maxId = Math.max(...unread.latest.map((i) => i.id));
            markRead(maxId);
          }}
        />
      )}

      {/* Message list */}
      <div className={styles.messageList} ref={listRef}>
        {displayMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming indicator */}
        {streamText && <StreamingIndicator text={streamText} />}

        {/* Scroll anchor */}
        <div ref={messageEndRef} />
      </div>

      {/* Error bar */}
      {error && (
        <div
          className={styles.errorBar}
          style={{ backgroundColor: colors.bgLight, color: colors.red }}
        >
          {error}
        </div>
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={busy || isDisconnected} />
    </div>
  );
}
