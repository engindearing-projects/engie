// Auto-connect: reads token/host/port from URL params, saves to localStorage, strips URL.
// Enables `engie web` to open the browser pre-authenticated.

import { saveConnectionConfig, setOnboarded } from './store';

export function applyUrlParams(): void {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const host = params.get('host');
  const port = params.get('port');

  if (token) {
    saveConnectionConfig(
      host || 'localhost',
      port || '18789',
      token,
    );
    setOnboarded();

    // Strip params from URL so token isn't visible in browser bar / history
    window.history.replaceState({}, '', window.location.pathname);
  }
}
