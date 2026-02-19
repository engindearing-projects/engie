import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from 'expo-router';
import { ConnectionBadge } from '../src/components/ConnectionBadge';
import { ObservationCard, type Observation } from '../src/components/ObservationCard';
import { PresetButton } from '../src/components/PresetButton';
import { useOpenClaw } from '../src/hooks/useOpenClaw';
import { colors } from '../src/theme/colors';

type PresetKey = 'recent' | 'blockers' | 'decisions' | 'profile';

const PRESETS: { key: PresetKey; label: string; message: string }[] = [
  { key: 'recent', label: 'Recent', message: 'Show my 10 most recent observations' },
  { key: 'blockers', label: 'Blockers', message: 'Show my current blockers' },
  { key: 'decisions', label: 'Decisions', message: 'Show recent decisions' },
  { key: 'profile', label: 'About Me', message: 'Show my profile and preferences' },
];

interface ProfileData {
  profile: Record<string, string>;
  preferences: Record<string, { value: unknown; updatedAt?: string }>;
}

export default function MemoryScreen() {
  const { messages, busy, connectionState, sendMessage, reconnect } = useOpenClaw();
  const navigation = useNavigation();

  const [activePreset, setActivePreset] = useState<PresetKey | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => <ConnectionBadge state={connectionState} />,
      headerRightContainerStyle: { paddingRight: 16 },
    });
  }, [navigation, connectionState]);

  useFocusEffect(
    useCallback(() => {
      if (connectionState === 'disconnected') {
        reconnect();
      }
    }, [connectionState, reconnect])
  );

  // Parse agent response for observation data
  useEffect(() => {
    if (!lastRequestId || busy) return;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    const text = lastMsg.text;

    // Try to extract JSON array of observations from the response
    try {
      // Look for JSON blocks in the response
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        setObservations(parsed);
        setProfileData(null);
      } else if (parsed.profile || parsed.preferences) {
        setProfileData(parsed);
        setObservations([]);
      } else if (parsed.totalObservations !== undefined) {
        // Stats response — show as profile-like data
        setProfileData(parsed);
        setObservations([]);
      }
    } catch {
      // Response wasn't parseable JSON — show observations from text
      // The agent may respond in natural language; that's fine
      setObservations([]);
      setProfileData(null);
    }

    setLoading(false);
    setLastRequestId(null);
  }, [messages, busy, lastRequestId]);

  const runQuery = useCallback(async (message: string, preset?: PresetKey) => {
    if (busy || connectionState !== 'connected') return;

    setLoading(true);
    setActivePreset(preset || null);
    setObservations([]);
    setProfileData(null);

    const reqId = `mem-${Date.now()}`;
    setLastRequestId(reqId);

    await sendMessage(message);
  }, [busy, connectionState, sendMessage]);

  const handlePreset = useCallback((preset: typeof PRESETS[number]) => {
    runQuery(preset.message, preset.key);
  }, [runQuery]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    runQuery(`Search my memory for: ${searchQuery.trim()}`);
    setSearchQuery('');
  }, [searchQuery, runQuery]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Preset buttons */}
      <View style={styles.presetsRow}>
        {PRESETS.map((p) => (
          <PresetButton
            key={p.key}
            label={p.label}
            active={activePreset === p.key}
            onPress={() => handlePreset(p)}
          />
        ))}
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search memory..."
          placeholderTextColor={colors.grayDim}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          editable={connectionState === 'connected' && !busy}
        />
      </View>

      {/* Results */}
      <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent}>
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.cyan} size="small" />
            <Text style={styles.loadingText}>Searching memory...</Text>
          </View>
        )}

        {!loading && profileData && activePreset === 'profile' && (
          <ProfileCard data={profileData} />
        )}

        {!loading && observations.length > 0 && (
          observations.map((obs) => (
            <ObservationCard key={obs.id} observation={obs} />
          ))
        )}

        {!loading && !profileData && observations.length === 0 && !lastRequestId && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🧠</Text>
            <Text style={styles.emptyTitle}>Engie's Memory</Text>
            <Text style={styles.emptyText}>
              Tap a button above to browse what Engie remembers, or search for something specific.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ProfileCard({ data }: { data: ProfileData }) {
  const profile = data.profile || {};
  const prefs = data.preferences || {};

  const profileEntries = Object.entries(profile).filter(([_, v]) => v);
  const prefEntries = Object.entries(prefs);

  return (
    <View style={styles.profileCard}>
      <Text style={styles.profileTitle}>User Profile</Text>
      {profileEntries.length > 0 ? (
        profileEntries.map(([key, value]) => (
          <View key={key} style={styles.profileRow}>
            <Text style={styles.profileKey}>{key}</Text>
            <Text style={styles.profileValue}>{String(value)}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.profileEmpty}>
          No profile data yet. Chat with Engie to build your profile!
        </Text>
      )}

      {prefEntries.length > 0 && (
        <>
          <Text style={[styles.profileTitle, { marginTop: 16 }]}>Preferences</Text>
          {prefEntries.map(([key, entry]) => {
            const val = typeof entry === 'object' && entry && 'value' in entry
              ? String(entry.value)
              : String(entry);
            return (
              <View key={key} style={styles.profileRow}>
                <Text style={styles.profileKey}>{key}</Text>
                <Text style={styles.profileValue}>{val}</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchInput: {
    backgroundColor: colors.bgLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.white,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.bgLighter,
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  loadingText: {
    color: colors.gray,
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyText: {
    color: colors.gray,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  profileCard: {
    backgroundColor: colors.bgLight,
    borderRadius: 12,
    padding: 16,
  },
  profileTitle: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgLighter,
  },
  profileKey: {
    color: colors.gray,
    fontSize: 13,
    textTransform: 'capitalize',
  },
  profileValue: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  profileEmpty: {
    color: colors.grayDim,
    fontSize: 13,
    fontStyle: 'italic',
  },
});
