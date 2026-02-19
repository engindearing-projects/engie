import { useState, useEffect, useCallback, useRef } from 'react';
import { colors } from '../theme/colors';
import { getConnectionConfig } from '../services/store';
import styles from './StatusPage.module.css';

interface ServiceStatus {
  name: string;
  url: string;
  healthy: boolean;
  latencyMs: number | null;
  checking: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;

async function checkHealth(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const latencyMs = Math.round(performance.now() - start);
    return { ok: res.ok, latencyMs };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, latencyMs };
  }
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildServiceList = useCallback((): { name: string; url: string }[] => {
    const config = getConnectionConfig();
    const gwHost = config.host || 'localhost';
    const gwPort = config.port || '18789';

    return [
      { name: 'Gateway', url: `http://${gwHost}:${gwPort}/` },
      { name: 'Claude Proxy', url: 'http://localhost:18791/health' },
      { name: 'Ollama', url: 'http://localhost:11434/api/tags' },
    ];
  }, []);

  const runChecks = useCallback(async () => {
    setRefreshing(true);
    const defs = buildServiceList();

    // Set initial checking state
    setServices(defs.map((d) => ({
      name: d.name,
      url: d.url,
      healthy: false,
      latencyMs: null,
      checking: true,
    })));

    const results = await Promise.all(
      defs.map(async (d) => {
        const result = await checkHealth(d.url);
        return {
          name: d.name,
          url: d.url,
          healthy: result.ok,
          latencyMs: result.latencyMs,
          checking: false,
        };
      })
    );

    setServices(results);
    setLastChecked(new Date());
    setRefreshing(false);
  }, [buildServiceList]);

  // Initial check + interval
  useEffect(() => {
    runChecks();
    intervalRef.current = setInterval(runChecks, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runChecks]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title} style={{ color: colors.white }}>
          Service Status
        </span>
        <button
          className={styles.refreshButton}
          style={{ color: colors.cyan, borderColor: colors.cyanDim }}
          onClick={runChecks}
          disabled={refreshing}
        >
          <span
            className={`${styles.refreshIcon} ${refreshing ? styles.refreshIconSpinning : ''}`}
          >
            &#x21bb;
          </span>
          Refresh
        </button>
      </div>

      <div className={styles.cards}>
        {services.map((svc) => {
          const statusColor = svc.checking
            ? colors.yellow
            : svc.healthy
              ? colors.green
              : colors.red;

          const statusText = svc.checking
            ? 'Checking'
            : svc.healthy
              ? 'Healthy'
              : 'Offline';

          return (
            <div
              key={svc.name}
              className={styles.card}
              style={{ backgroundColor: colors.bgLight }}
            >
              <span
                className={`${styles.statusDot} ${svc.checking ? styles.statusDotPulse : ''}`}
                style={{ backgroundColor: statusColor }}
              />

              <div className={styles.cardInfo}>
                <span className={styles.serviceName} style={{ color: colors.white }}>
                  {svc.name}
                </span>
                <span className={styles.serviceUrl} style={{ color: colors.grayDim }}>
                  {svc.url}
                </span>
              </div>

              <div className={styles.cardMeta}>
                <span className={styles.statusLabel} style={{ color: statusColor }}>
                  {statusText}
                </span>
                {svc.latencyMs !== null && (
                  <span className={styles.latency} style={{ color: colors.grayDim }}>
                    {svc.latencyMs}ms
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {lastChecked && (
        <span className={styles.lastChecked} style={{ color: colors.grayDim }}>
          Last checked: {lastChecked.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
