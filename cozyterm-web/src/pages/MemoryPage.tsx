import { useState, useEffect, useCallback, useRef } from 'react';
import { colors } from '../theme/colors';
import { useGateway } from '../hooks/useGateway';
import { ObservationCard, type Observation } from '../components/ObservationCard';
import { PresetButton } from '../components/PresetButton';
import styles from './MemoryPage.module.css';

const PRESETS = [
  { label: 'Recent', query: 'Show my most recent memory observations as a JSON array with fields: id, type, timestamp, project, summary, tags' },
  { label: 'Blockers', query: 'Show all blocker observations from memory as a JSON array with fields: id, type, timestamp, project, summary, tags' },
  { label: 'Decisions', query: 'Show all decision observations from memory as a JSON array with fields: id, type, timestamp, project, summary, tags' },
  { label: 'About Me', query: 'Show my profile and preferences from memory as a JSON object with a "profile" key containing key-value pairs' },
];

interface ProfileData {
  [key: string]: string | number | boolean;
}

function tryParseObservations(text: string): Observation[] | null {
  try {
    // Try to find a JSON array in the response
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].summary) {
        return parsed as Observation[];
      }
    }
  } catch {
    // not valid JSON array
  }
  return null;
}

function tryParseProfile(text: string): ProfileData | null {
  try {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed.profile && typeof parsed.profile === 'object') {
        return parsed.profile as ProfileData;
      }
      if (parsed.preferences && typeof parsed.preferences === 'object') {
        return parsed.preferences as ProfileData;
      }
    }
  } catch {
    // not valid JSON object
  }
  return null;
}

export default function MemoryPage() {
  const { messages, busy, sendMessage } = useGateway();
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const lastMsgCountRef = useRef(messages.length);

  // Watch for new assistant messages
  useEffect(() => {
    if (messages.length <= lastMsgCountRef.current) {
      lastMsgCountRef.current = messages.length;
      return;
    }
    lastMsgCountRef.current = messages.length;

    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    const text = lastMsg.text;

    // Try observations first
    const obs = tryParseObservations(text);
    if (obs) {
      setObservations(obs);
      setProfile(null);
      return;
    }

    // Try profile
    const prof = tryParseProfile(text);
    if (prof) {
      setProfile(prof);
      setObservations([]);
      return;
    }

    // Nothing parseable — clear results
    setObservations([]);
    setProfile(null);
  }, [messages]);

  const handlePreset = useCallback((label: string, query: string) => {
    setActivePreset(label);
    setHasSearched(true);
    setObservations([]);
    setProfile(null);
    sendMessage(query);
  }, [sendMessage]);

  const handleSearch = useCallback(() => {
    if (!searchText.trim()) return;
    setActivePreset(null);
    setHasSearched(true);
    setObservations([]);
    setProfile(null);
    sendMessage(
      `Search memory for: "${searchText.trim()}". Return results as a JSON array with fields: id, type, timestamp, project, summary, tags`
    );
  }, [searchText, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }, [handleSearch]);

  // Render content area
  const renderContent = () => {
    if (busy) {
      return (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText} style={{ color: colors.gray }}>
            Searching memory...
          </span>
        </div>
      );
    }

    if (profile) {
      return (
        <div className={styles.profileCard} style={{ backgroundColor: colors.bgLight }}>
          <div className={styles.profileTitle} style={{ color: colors.cyan }}>
            Profile
          </div>
          {Object.entries(profile).map(([key, value]) => (
            <div
              key={key}
              className={styles.profileRow}
              style={{ borderBottomColor: colors.bgLighter }}
            >
              <span className={styles.profileKey} style={{ color: colors.gray }}>
                {key.replace(/_/g, ' ')}
              </span>
              <span className={styles.profileValue} style={{ color: colors.white }}>
                {String(value)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    if (observations.length > 0) {
      return (
        <div className={styles.results}>
          {observations.map((obs) => (
            <ObservationCard key={obs.id} observation={obs} />
          ))}
        </div>
      );
    }

    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyTitle} style={{ color: colors.white }}>
          Memory
        </span>
        <span className={styles.emptyDesc} style={{ color: colors.gray }}>
          {hasSearched
            ? 'No results. Try a different search or preset.'
            : 'Search observations, decisions, and blockers. Use the presets above or type a query.'}
        </span>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.presets}>
        {PRESETS.map((p) => (
          <PresetButton
            key={p.label}
            label={p.label}
            active={activePreset === p.label}
            onPress={() => handlePreset(p.label, p.query)}
          />
        ))}
      </div>

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          style={{
            backgroundColor: colors.bgLight,
            borderColor: colors.bgLighter,
            color: colors.white,
          }}
          placeholder="Search memory..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {renderContent()}
    </div>
  );
}
