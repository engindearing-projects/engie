// Activity sync hook (mobile) — logs messages and fetches unread state.
// Reads gateway host from SecureStore to build the activity server URL (LAN IP, not localhost).

import { useState, useCallback, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';

const ACTIVITY_PORT = 18790;
const PLATFORM = 'mobile';

interface UnreadItem {
  id: number;
  platform: string;
  role: string;
  content: string;
  created_at: string;
}

export interface UnreadState {
  unreadCount: number;
  cursor: number;
  latest: UnreadItem[];
}

async function getActivityUrl(): Promise<string | null> {
  try {
    const host = await SecureStore.getItemAsync('engie_gw_host');
    if (!host) return null;
    return `http://${host}:${ACTIVITY_PORT}`;
  } catch {
    return null;
  }
}

export function useActivitySync() {
  const [unread, setUnread] = useState<UnreadState | null>(null);
  const fetchedRef = useRef(false);

  const logActivity = useCallback(async (role: string, content: string, sessionKey = 'main') => {
    try {
      const url = await getActivityUrl();
      if (!url) return;
      await fetch(`${url}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: PLATFORM, session_key: sessionKey, role, content }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Silent fail
    }
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const url = await getActivityUrl();
      if (!url) return;
      const res = await fetch(`${url}/unread?platform=${PLATFORM}`, {
        signal: AbortSignal.timeout(3000),
      });
      const data: UnreadState = await res.json();
      if (data.unreadCount > 0) {
        setUnread(data);
      }
    } catch {
      // Silent fail
    }
  }, []);

  const markRead = useCallback(async (lastSeenId: number) => {
    try {
      const url = await getActivityUrl();
      if (!url) return;
      await fetch(`${url}/cursor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: PLATFORM, last_seen_id: lastSeenId }),
        signal: AbortSignal.timeout(3000),
      });
      setUnread(null);
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchUnread();
  }, [fetchUnread]);

  return { unread, logActivity, markRead };
}
