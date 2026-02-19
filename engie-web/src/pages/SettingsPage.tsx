import { useState, useEffect, useCallback } from 'react';
import { colors } from '../theme/colors';
import { getConnectionConfig, saveConnectionConfig } from '../services/store';
import { OpenClawClient } from '../services/OpenClawClient';
import styles from './SettingsPage.module.css';

type FeedbackType = 'success' | 'error' | 'info';

interface Feedback {
  message: string;
  type: FeedbackType;
}

export default function SettingsPage() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const config = getConnectionConfig();
    setHost(config.host);
    setPort(config.port);
    setToken(config.token);
  }, []);

  const handleSave = useCallback(() => {
    saveConnectionConfig(host.trim(), port.trim(), token.trim());
    setFeedback({ message: 'Saved!', type: 'success' });
    setTimeout(() => setFeedback(null), 3000);
  }, [host, port, token]);

  const handleTest = useCallback(async () => {
    if (!host.trim() || !token.trim()) {
      setFeedback({ message: 'Host and token are required', type: 'error' });
      return;
    }

    setTesting(true);
    setFeedback(null);

    const client = new OpenClawClient(
      host.trim(),
      parseInt(port.trim() || '18789', 10),
      token.trim()
    );

    try {
      await client.connect();
      client.disconnect();
      setFeedback({ message: 'Connection successful!', type: 'success' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setFeedback({ message: `Connection failed: ${errMsg}`, type: 'error' });
    } finally {
      setTesting(false);
    }
  }, [host, port, token]);

  const handleClearHistory = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    // Clear stored messages (if any stored in localStorage)
    localStorage.removeItem('engie_messages');
    setConfirmClear(false);
    setFeedback({ message: 'Chat history cleared', type: 'info' });
    setTimeout(() => setFeedback(null), 3000);
  }, [confirmClear]);

  const feedbackColor = feedback
    ? feedback.type === 'success'
      ? colors.green
      : feedback.type === 'error'
        ? colors.red
        : colors.cyan
    : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <span className={styles.sectionTitle} style={{ color: colors.white }}>
          Gateway Connection
        </span>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: colors.gray }}>
            Host
          </label>
          <input
            className={styles.input}
            style={{
              backgroundColor: colors.bgLight,
              borderColor: colors.bgLighter,
              color: colors.white,
            }}
            placeholder="192.168.1.100"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: colors.gray }}>
            Port
          </label>
          <input
            className={styles.input}
            style={{
              backgroundColor: colors.bgLight,
              borderColor: colors.bgLighter,
              color: colors.white,
            }}
            placeholder="18789"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} style={{ color: colors.gray }}>
            Token
          </label>
          <input
            className={styles.input}
            type="password"
            style={{
              backgroundColor: colors.bgLight,
              borderColor: colors.bgLighter,
              color: colors.white,
            }}
            placeholder="Gateway auth token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div className={styles.buttonRow}>
          <button
            className={styles.buttonPrimary}
            style={{
              backgroundColor: colors.cyan,
              color: colors.bg,
              borderColor: colors.cyan,
            }}
            onClick={handleSave}
          >
            Save
          </button>
          <button
            className={styles.buttonSecondary}
            style={{
              backgroundColor: 'transparent',
              color: colors.cyan,
              borderColor: colors.cyanDim,
            }}
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={styles.feedback}
          style={{
            backgroundColor: `${feedbackColor}15`,
            color: feedbackColor,
            border: `1px solid ${feedbackColor}40`,
          }}
        >
          {feedback.message}
        </div>
      )}

      <hr className={styles.divider} style={{ backgroundColor: colors.bgLighter }} />

      <div className={styles.section}>
        <span className={styles.sectionTitle} style={{ color: colors.white }}>
          Data
        </span>

        {confirmClear ? (
          <div className={styles.confirmRow}>
            <span className={styles.confirmText} style={{ color: colors.yellow }}>
              Are you sure?
            </span>
            <button
              className={styles.buttonDanger}
              style={{
                backgroundColor: colors.red,
                color: colors.white,
                borderColor: colors.red,
              }}
              onClick={handleClearHistory}
            >
              Yes, Clear
            </button>
            <button
              className={styles.buttonSecondary}
              style={{
                backgroundColor: 'transparent',
                color: colors.gray,
                borderColor: colors.bgLighter,
              }}
              onClick={() => setConfirmClear(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className={styles.buttonDanger}
            style={{
              backgroundColor: 'transparent',
              color: colors.red,
              borderColor: colors.red,
            }}
            onClick={handleClearHistory}
          >
            Clear Chat History
          </button>
        )}
      </div>
    </div>
  );
}
