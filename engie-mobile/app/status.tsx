import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors } from '../src/theme/colors';

const STORE_KEY_HOST = 'engie_gw_host';
const STORE_KEY_PORT = 'engie_gw_port';

const REFRESH_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

type HealthState = 'healthy' | 'unhealthy' | 'checking' | 'unknown';

interface ServiceCheck {
  name: string;
  state: HealthState;
  latencyMs: number | null;
  detail: string;
}

const DOT_COLORS: Record<HealthState, string> = {
  healthy: colors.green,
  unhealthy: colors.red,
  checking: colors.yellow,
  unknown: colors.grayDim,
};

const STATE_LABELS: Record<HealthState, string> = {
  healthy: 'Healthy',
  unhealthy: 'Unreachable',
  checking: 'Checking...',
  unknown: 'Unknown',
};

async function timedFetch(url: string, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    return { ok: res.ok, latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function checkGateway(host: string, port: string): Promise<ServiceCheck> {
  if (!host) {
    return { name: 'Gateway', state: 'unknown', latencyMs: null, detail: 'Not configured' };
  }

  // The gateway doesn't have an HTTP health endpoint, so we check if the
  // WebSocket port is reachable by attempting a plain HTTP fetch to it.
  // The gateway will reject the non-WS request, but a response means it's up.
  const url = `http://${host}:${port || '18789'}/`;
  const { ok, latencyMs } = await timedFetch(url, FETCH_TIMEOUT_MS);

  // Any response (even 4xx) means the port is open and the gateway is running.
  // A timeout / network error means it's unreachable.
  // timedFetch returns ok=false for both HTTP errors and network errors,
  // so we use latencyMs < FETCH_TIMEOUT_MS as a heuristic for "port responded."
  const reachable = latencyMs < FETCH_TIMEOUT_MS - 500;

  return {
    name: 'Gateway',
    state: reachable ? 'healthy' : 'unhealthy',
    latencyMs: reachable ? latencyMs : null,
    detail: reachable ? 'Connected' : 'Unreachable',
  };
}

async function checkClaudeProxy(host: string): Promise<ServiceCheck> {
  if (!host) {
    return { name: 'Claude Proxy', state: 'unknown', latencyMs: null, detail: 'Not configured' };
  }

  const url = `http://${host}:18791/health`;
  const { ok, latencyMs } = await timedFetch(url, FETCH_TIMEOUT_MS);

  return {
    name: 'Claude Proxy',
    state: ok ? 'healthy' : 'unhealthy',
    latencyMs: ok ? latencyMs : null,
    detail: ok ? 'Healthy' : 'Unreachable',
  };
}

async function checkOllama(host: string): Promise<ServiceCheck> {
  if (!host) {
    return { name: 'Ollama', state: 'unknown', latencyMs: null, detail: 'Not configured' };
  }

  const url = `http://${host}:11434/api/tags`;
  const { ok, latencyMs } = await timedFetch(url, FETCH_TIMEOUT_MS);

  return {
    name: 'Ollama',
    state: ok ? 'healthy' : 'unhealthy',
    latencyMs: ok ? latencyMs : null,
    detail: ok ? 'Healthy' : 'Unreachable',
  };
}

export default function StatusScreen() {
  const [services, setServices] = useState<ServiceCheck[]>([
    { name: 'Gateway', state: 'unknown', latencyMs: null, detail: 'Waiting...' },
    { name: 'Claude Proxy', state: 'unknown', latencyMs: null, detail: 'Waiting...' },
    { name: 'Ollama', state: 'unknown', latencyMs: null, detail: 'Waiting...' },
  ]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runChecks = useCallback(async () => {
    const host = (await SecureStore.getItemAsync(STORE_KEY_HOST)) || '';
    const port = (await SecureStore.getItemAsync(STORE_KEY_PORT)) || '18789';

    // Set all to "checking" state
    setServices((prev) =>
      prev.map((s) => ({ ...s, state: 'checking' as HealthState, detail: 'Checking...' })),
    );

    const [gw, proxy, ollama] = await Promise.all([
      checkGateway(host, port),
      checkClaudeProxy(host),
      checkOllama(host),
    ]);

    setServices([gw, proxy, ollama]);
    setLastChecked(new Date());
  }, []);

  useEffect(() => {
    runChecks();
    intervalRef.current = setInterval(runChecks, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runChecks]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runChecks();
    setRefreshing(false);
  }, [runChecks]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.cyan}
          colors={[colors.cyan]}
        />
      }
    >
      <Text style={styles.sectionTitle}>Service Health</Text>
      <Text style={styles.sectionHint}>
        Pull down to refresh. Auto-checks every 30 seconds.
      </Text>

      <View style={styles.card}>
        {services.map((svc, i) => (
          <View key={svc.name}>
            <View style={styles.row}>
              <View style={styles.nameColumn}>
                <Text style={styles.serviceName}>{svc.name}</Text>
              </View>
              <View style={styles.statusColumn}>
                {svc.state === 'checking' ? (
                  <ActivityIndicator size="small" color={colors.yellow} />
                ) : (
                  <View
                    style={[styles.dot, { backgroundColor: DOT_COLORS[svc.state] }]}
                  />
                )}
                <Text
                  style={[styles.statusLabel, { color: DOT_COLORS[svc.state] }]}
                >
                  {STATE_LABELS[svc.state]}
                </Text>
              </View>
              <View style={styles.latencyColumn}>
                <Text style={styles.latency}>
                  {svc.latencyMs !== null ? `${svc.latencyMs}ms` : '--'}
                </Text>
              </View>
            </View>
            {i < services.length - 1 && <View style={styles.rowDivider} />}
          </View>
        ))}
      </View>

      {lastChecked && (
        <Text style={styles.lastChecked}>
          Last checked: {lastChecked.toLocaleTimeString()}
        </Text>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Ports</Text>
        <Text style={styles.infoRow}>Gateway:  18789 (WebSocket)</Text>
        <Text style={styles.infoRow}>Claude Proxy:  18791 (HTTP)</Text>
        <Text style={styles.infoRow}>Ollama:  11434 (HTTP)</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.cyan,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.grayDim,
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.bgLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.bgLighter,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.bgLighter,
    marginHorizontal: 16,
  },
  nameColumn: {
    flex: 1,
  },
  serviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
  statusColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 110,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  latencyColumn: {
    minWidth: 50,
    alignItems: 'flex-end',
  },
  latency: {
    fontSize: 13,
    color: colors.grayDim,
    fontVariant: ['tabular-nums'],
  },
  lastChecked: {
    fontSize: 12,
    color: colors.grayDim,
    textAlign: 'center',
    marginTop: 16,
  },
  infoCard: {
    backgroundColor: colors.bgLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.bgLighter,
    padding: 16,
    marginTop: 24,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray,
    marginBottom: 8,
  },
  infoRow: {
    fontSize: 13,
    color: colors.grayDim,
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
  },
});
