import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export interface Observation {
  id: string;
  type: string;
  timestamp: string;
  project?: string;
  summary: string;
  tags?: string[];
}

interface Props {
  observation: Observation;
}

const TYPE_DOTS: Record<string, string> = {
  task_update: '#3b82f6',
  code_change: '#a855f7',
  decision: '#22c55e',
  blocker: '#ef4444',
  preference: '#eab308',
  insight: '#06b6d4',
  chat_exchange: '#6b7280',
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function ObservationCard({ observation }: Props) {
  const dotColor = TYPE_DOTS[observation.type] || colors.grayDim;
  const tags = observation.tags || [];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.type}>{observation.type.replace('_', ' ')}</Text>
        <Text style={styles.time}>{relativeTime(observation.timestamp)}</Text>
      </View>
      <Text style={styles.summary}>{observation.summary}</Text>
      {(tags.length > 0 || observation.project) && (
        <View style={styles.meta}>
          {observation.project && (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{observation.project}</Text>
            </View>
          )}
          {tags.map((tag) => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  type: {
    color: colors.gray,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
    flex: 1,
  },
  time: {
    color: colors.grayDim,
    fontSize: 11,
  },
  summary: {
    color: colors.white,
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: '500',
  },
});
