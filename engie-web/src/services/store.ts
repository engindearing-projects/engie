// Simple localStorage wrapper for gateway connection settings.
// Replaces expo-secure-store from mobile.

const KEYS = {
  host: 'engie_gw_host',
  port: 'engie_gw_port',
  token: 'engie_gw_token',
  onboarded: 'engie_onboarded',
} as const;

export function getConnectionConfig() {
  return {
    host: localStorage.getItem(KEYS.host) || '',
    port: localStorage.getItem(KEYS.port) || '18789',
    token: localStorage.getItem(KEYS.token) || '',
  };
}

export function saveConnectionConfig(host: string, port: string, token: string) {
  localStorage.setItem(KEYS.host, host);
  localStorage.setItem(KEYS.port, port);
  localStorage.setItem(KEYS.token, token);
}

export function isOnboarded(): boolean {
  return localStorage.getItem(KEYS.onboarded) === 'true';
}

export function setOnboarded() {
  localStorage.setItem(KEYS.onboarded, 'true');
}
