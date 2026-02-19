// Activity sync hook — logs messages and fetches unread state from the activity server.
// All calls are fire-and-forget; if the server is down, everything still works.

import { useState, useCallback, useEffect, useRef } from 'react';

const ACTIVITY_URL = 'http://localhost:18790';
const PLATFORM = 'web';

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

export function useActivitySync() {
  const [unread, setUnread] = useState<UnreadState | null>(null);
  const fetchedRef = useRef(false);

  const logActivity = useCallback(async (role: string, content: string, sessionKey = 'main') => {
    try {
      await fetch(`${ACTIVITY_URL}/activity`, {
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
      const res = await fetch(`${ACTIVITY_URL}/unread?platform=${PLATFORM}`, {
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
      await fetch(`${ACTIVITY_URL}/cursor`, {
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

  // Fetch unread on mount (once)
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchUnread();
  }, [fetchUnread]);

  return { unread, logActivity, markRead };
}
