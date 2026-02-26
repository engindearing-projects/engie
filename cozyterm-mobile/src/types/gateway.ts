// TypeScript types for the Gateway gateway WebSocket protocol

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

// --- Outbound (client → gateway) ---

export interface ConnectRequest {
  type: 'req';
  id: string;
  method: 'connect';
  params: {
    minProtocol: number;
    maxProtocol: number;
    client: {
      id: string;
      version: string;
      platform: string;
      mode: string;
    };
    role: string;
    scopes: string[];
    auth: { token: string };
  };
}

export interface ChatSendRequest {
  type: 'req';
  id: string;
  method: 'chat.send';
  params: {
    sessionKey: string;
    message: string;
    idempotencyKey: string;
  };
}

export interface GenericRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

// --- Inbound (gateway → client) ---

export interface ConnectChallengeEvent {
  type: 'event';
  event: 'connect.challenge';
}

export interface AgentEvent {
  type: 'event';
  event: 'agent';
  payload: {
    sessionKey: string;
    stream: 'assistant' | 'lifecycle' | 'tool' | string;
    data: {
      delta?: string;
      text?: string;
      content?: string;
      phase?: string;
      message?: string;
    };
  };
}

export interface ChatEvent {
  type: 'event';
  event: 'chat';
  payload: {
    sessionKey: string;
    state: 'final' | 'error' | string;
    message?: {
      content: string | Array<{ type: string; text?: string }>;
    };
    errorMessage?: string;
  };
}

export interface NoiseEvent {
  type: 'event';
  event: 'tick' | 'health' | 'presence';
}

export interface ResponseMessage {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
}

export type GatewayInbound =
  | ConnectChallengeEvent
  | AgentEvent
  | ChatEvent
  | NoiseEvent
  | ResponseMessage;

// --- Client callbacks ---

export interface GatewayCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAgent?: (payload: AgentEvent['payload']) => void;
  onChat?: (payload: ChatEvent['payload']) => void;
  onError?: (error: string) => void;
}
