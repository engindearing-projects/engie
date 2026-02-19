import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import type { ConnectionState } from '../types/gateway';

interface Props {
  state: ConnectionState;
}

const STATUS_CONFIG: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: colors.green, label: 'Connected' },
  connecting: { color: colors.yellow, label: 'Connecting...' },
  disconnected: { color: colors.red, label: 'Disconnected' },
};

export function ConnectionBadge({ state }: Props) {
  const { color, label } = STATUS_CONFIG[state];

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});
