import { useState, useEffect, useCallback, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { GatewayClient } from '../services/GatewayClient';
import type { Message, ConnectionState, AgentEvent, ChatEvent } from '../types/gateway';

const STORE_KEY_HOST = 'engie_gw_host';
const STORE_KEY_PORT = 'engie_gw_port';
const STORE_KEY_TOKEN = 'engie_gw_token';
const SESSION_KEY = 'main';

function matchesSession(eventKey: string): boolean {
  return eventKey === SESSION_KEY || eventKey.endsWith(`:${SESSION_KEY}`);
}

let msgCounter = 0;

export interface UseGatewayReturn {
  messages: Message[];
  streamText: string;
  busy: boolean;
  connectionState: ConnectionState;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  reconnect: () => Promise<void>;
  clearMessages: () => void;
}

export function useGateway(): UseGatewayReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<GatewayClient | null>(null);
  const accumulatedRef = useRef('');

  const setupClient = useCallback(async () => {
    // Clean up previous client
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    const host = await SecureStore.getItemAsync(STORE_KEY_HOST);
    const port = await SecureStore.getItemAsync(STORE_KEY_PORT);
    const token = await SecureStore.getItemAsync(STORE_KEY_TOKEN);

    if (!host || !token) {
      setConnectionState('disconnected');
      setError('Gateway not configured — go to Settings');
      return;
    }

    const client = new GatewayClient(host, parseInt(port || '18789', 10), token);

    client.callbacks = {
      onConnected: () => {
        setConnectionState('connected');
        setError(null);
      },
      onDisconnected: () => {
        setConnectionState('connecting'); // auto-reconnect in progress
        setError('Reconnecting...');
        setBusy(false);
      },
      onAgent: (payload: AgentEvent['payload']) => {
        if (!matchesSession(payload.sessionKey)) return;

        const data = payload.data || {};
        const stream = payload.stream;

        // Lifecycle errors
        if (stream === 'lifecycle') {
          if (data.phase === 'error') {
            setError(data.message || 'Agent error');
            setBusy(false);
          }
          return;
        }

        // Assistant text stream
        if (stream === 'assistant') {
          const fullText = data.text || data.content || '';
          const delta = data.delta || '';
          if (!fullText && !delta) return;

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
      },
      onChat: (payload: ChatEvent['payload']) => {
        if (!matchesSession(payload.sessionKey)) return;

        if (payload.state === 'final') {
          let finalText = accumulatedRef.current;

          if (!finalText && payload.message?.content) {
            const content = payload.message.content;
            if (typeof content === 'string') {
              finalText = content;
            } else if (Array.isArray(content)) {
              finalText = content
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('\n');
            }
          }

          if (finalText) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${++msgCounter}`,
                role: 'assistant',
                text: finalText,
                timestamp: Date.now(),
              },
            ]);
          }

          setStreamText('');
          accumulatedRef.current = '';
          setBusy(false);
          setError(null);
        }

        if (payload.state === 'error') {
          setError(payload.errorMessage || 'Unknown error');
          setStreamText('');
          accumulatedRef.current = '';
          setBusy(false);
        }
      },
      onError: (err: string) => {
        setError(err);
      },
    };

    clientRef.current = client;
    setConnectionState('connecting');

    try {
      await client.connect();
    } catch (err) {
      setConnectionState('disconnected');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    setupClient();
    return () => {
      clientRef.current?.disconnect();
    };
  }, [setupClient]);

  const sendMessage = useCallback(async (text: string) => {
    const client = clientRef.current;
    if (!text.trim() || busy || !client?.connected) return;

    setError(null);
    setBusy(true);
    accumulatedRef.current = '';
    setStreamText('');

    setMessages((prev) => [
      ...prev,
      {
        id: `u-${++msgCounter}`,
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      },
    ]);

    try {
      await client.chat(text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [busy]);

  const reconnect = useCallback(async () => {
    await setupClient();
  }, [setupClient]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamText('');
    accumulatedRef.current = '';
  }, []);

  return { messages, streamText, busy, connectionState, error, sendMessage, reconnect, clearMessages };
}
