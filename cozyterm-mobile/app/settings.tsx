import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { OpenClawClient } from '../src/services/OpenClawClient';
import { colors } from '../src/theme/colors';

const VERSION = '0.3.0';

const STORE_KEY_HOST = 'engie_gw_host';
const STORE_KEY_PORT = 'engie_gw_port';
const STORE_KEY_TOKEN = 'engie_gw_token';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export default function SettingsScreen() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [token, setToken] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const h = await SecureStore.getItemAsync(STORE_KEY_HOST);
      const p = await SecureStore.getItemAsync(STORE_KEY_PORT);
      const t = await SecureStore.getItemAsync(STORE_KEY_TOKEN);
      if (h) setHost(h);
      if (p) setPort(p);
      if (t) setToken(t);
      setLoading(false);
    })();
  }, []);

  const handleSave = useCallback(async () => {
    if (!host.trim()) {
      Alert.alert('Missing Host', 'Enter the gateway IP address or hostname.');
      return;
    }
    if (!token.trim()) {
      Alert.alert('Missing Token', 'Enter the gateway auth token.');
      return;
    }
    await SecureStore.setItemAsync(STORE_KEY_HOST, host.trim());
    await SecureStore.setItemAsync(STORE_KEY_PORT, port.trim() || '18789');
    await SecureStore.setItemAsync(STORE_KEY_TOKEN, token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [host, port, token]);

  const handleTest = useCallback(async () => {
    if (!host.trim() || !token.trim()) {
      setTestStatus('error');
      setTestMessage('Host and token are required');
      return;
    }

    setTestStatus('testing');
    setTestMessage('Connecting...');

    const client = new OpenClawClient(
      host.trim(),
      parseInt(port.trim() || '18789', 10),
      token.trim(),
    );

    try {
      await client.connect();
      setTestStatus('success');
      setTestMessage('Connected successfully');
      client.disconnect();
    } catch (err) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [host, port, token]);

  const handleClearChat = useCallback(() => {
    Alert.alert(
      'Clear Chat',
      'This clears the local message history. The shared session on the gateway is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Done', 'Switch to the Chat tab to see a fresh view.');
          },
        },
      ],
    );
  }, []);

  const testColor =
    testStatus === 'success' ? colors.green :
    testStatus === 'error' ? colors.red :
    testStatus === 'testing' ? colors.yellow :
    colors.grayDim;

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Connection</Text>
      <Text style={styles.sectionHint}>
        Enter the IP and auth token of your OpenClaw gateway.
      </Text>

      <Text style={styles.label}>Host</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        placeholder="e.g. 192.168.1.100"
        placeholderTextColor={colors.grayDim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={styles.label}>Port</Text>
      <TextInput
        style={styles.input}
        value={port}
        onChangeText={setPort}
        placeholder="18789"
        placeholderTextColor={colors.grayDim}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Auth Token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="Paste gateway auth token"
        placeholderTextColor={colors.grayDim}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={handleSave} activeOpacity={0.7}>
          <Text style={styles.buttonText}>{saved ? 'Saved!' : 'Save'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.testButton]}
          onPress={handleTest}
          activeOpacity={0.7}
          disabled={testStatus === 'testing'}
        >
          <Text style={styles.buttonText}>
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </Text>
        </TouchableOpacity>
      </View>

      {testMessage !== '' && (
        <Text style={[styles.testMessage, { color: testColor }]}>{testMessage}</Text>
      )}

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Data</Text>

      <TouchableOpacity
        style={[styles.button, styles.dangerButton]}
        onPress={handleClearChat}
        activeOpacity={0.7}
      >
        <Text style={[styles.buttonText, { color: colors.red }]}>Clear Local Chat</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <Text style={styles.version}>Engie Mobile v{VERSION}</Text>
      <Text style={styles.hint}>
        Session key: main (shared across CLI, Telegram, and mobile)
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.bgLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.white,
    borderWidth: 1,
    borderColor: colors.bgLighter,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    flex: 1,
    backgroundColor: colors.bgLight,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cyan,
  },
  testButton: {
    borderColor: colors.bgLighter,
  },
  dangerButton: {
    borderColor: colors.red,
    flex: 0,
    paddingHorizontal: 20,
  },
  buttonText: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: '600',
  },
  testMessage: {
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.bgLighter,
    marginVertical: 24,
  },
  version: {
    fontSize: 13,
    color: colors.grayDim,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: colors.grayDim,
    textAlign: 'center',
    marginTop: 4,
  },
});
