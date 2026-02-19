import * as Crypto from 'expo-crypto';
import type {
  OpenClawCallbacks,
  AgentEvent,
  ChatEvent,
  GatewayInbound,
} from '../types/gateway';

const SESSION_KEY = 'main';
const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class OpenClawClient {
  private host: string;
  private port: number;
  private token: string;
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<string, PendingRequest>();
  private _intentionalClose = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempt = 0;

  connected = false;
  callbacks: OpenClawCallbacks = {};

  constructor(host: string, port: number, token: string) {
    this.host = host;
    this.port = port;
    this.token = token;
  }

  private nextId(): string {
    return String(++this.reqId);
  }

  connect(): Promise<void> {
    this._intentionalClose = false;
    this._reconnectAttempt = 0;

    return this._doConnect();
  }

  private _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}`;

      // Clean up any previous socket
      if (this.ws) {
        try { this.ws.close(); } catch {}
        this.ws = null;
      }

      this.ws = new WebSocket(url);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Gateway connection timed out'));
        try { this.ws?.close(); } catch {}
      }, CONNECT_TIMEOUT_MS);

      let connectResolved = false;

      this.ws.onmessage = (event) => {
        let msg: GatewayInbound;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return;
        }

        // Phase 1: connection handshake
        if (msg.type === 'event' && 'event' in msg && msg.event === 'connect.challenge') {
          const id = this.nextId();
          this._send({
            type: 'req',
            id,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'openclaw-control-ui',
                version: '1.0.0',
                platform: 'react-native',
                mode: 'ui',
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.pairing', 'chat'],
              auth: { token: this.token },
            },
          });
          return;
        }

        // Connect response (always id "1")
        if (msg.type === 'res' && 'id' in msg && msg.id === '1') {
          clearTimeout(connectTimeout);
          connectResolved = true;
          if (!('ok' in msg) || !msg.ok) {
            reject(new Error(`Gateway auth failed: ${JSON.stringify('error' in msg ? msg.error : msg)}`));
            return;
          }
          this.connected = true;
          this._reconnectAttempt = 0;
          this.callbacks.onConnected?.();
          resolve();
          return;
        }

        // Pending request responses
        if (msg.type === 'res' && 'id' in msg) {
          const id = (msg as { id: string }).id;
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
            if ('ok' in msg && msg.ok) {
              pending.resolve('payload' in msg ? msg.payload : undefined);
            } else {
              pending.reject(new Error(JSON.stringify('error' in msg ? msg.error : msg)));
            }
            return;
          }
        }

        // Agent streaming events
        if (msg.type === 'event' && 'event' in msg && msg.event === 'agent') {
          this.callbacks.onAgent?.((msg as AgentEvent).payload);
          return;
        }

        // Chat state events
        if (msg.type === 'event' && 'event' in msg && msg.event === 'chat') {
          this.callbacks.onChat?.((msg as ChatEvent).payload);
          return;
        }

        // Skip noise (tick, health, presence)
      };

      this.ws.onerror = () => {
        clearTimeout(connectTimeout);
        if (!connectResolved) {
          reject(new Error('WebSocket connection error'));
        } else {
          this.callbacks.onError?.('WebSocket error');
        }
      };

      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;

        if (wasConnected && !this._intentionalClose) {
          this.callbacks.onDisconnected?.();
          this._scheduleReconnect();
        }
      };
    });
  }

  private _send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private _scheduleReconnect(): void {
    if (this._intentionalClose) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this._reconnectAttempt++;

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this._doConnect();
      } catch {
        // _doConnect failure → onclose will fire → _scheduleReconnect again
      }
    }, delay);
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ type: 'req', id, method, params });
    });
  }

  async chat(message: string): Promise<unknown> {
    const idempotencyKey = Crypto.randomUUID();
    return this.request('chat.send', {
      sessionKey: SESSION_KEY,
      message,
      idempotencyKey,
    });
  }

  disconnect(): void {
    this._intentionalClose = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error('Disconnected'));
    }
    this.pending.clear();

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connected = false;
  }
}
