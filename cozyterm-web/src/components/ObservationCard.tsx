import { colors } from '../theme/colors';
import styles from './ObservationCard.module.css';

export interface Observation {
  id: string;
  type: string;
  timestamp: string | number;
  project?: string;
  summary: string;
  tags?: string[];
}

interface Props {
  observation: Observation;
}

const typeColors: Record<string, string> = {
  task_update: '#3b82f6',
  code_change: '#a855f7',
  decision: '#22c55e',
  blocker: '#ef4444',
  preference: '#eab308',
  insight: '#06b6d4',
  chat_exchange: '#6b7280',
};

function formatRelativeTime(ts: string | number): string {
  const now = Date.now();
  const then = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

export function ObservationCard({ observation }: Props) {
  const dotColor = typeColors[observation.type] || colors.grayDim;

  return (
    <div className={styles.card} style={{ backgroundColor: colors.bgLight }}>
      <div className={styles.header}>
        <span className={styles.typeDot} style={{ backgroundColor: dotColor }} />
        <span className={styles.typeLabel} style={{ color: dotColor }}>
          {formatType(observation.type)}
        </span>
        <span className={styles.timestamp} style={{ color: colors.grayDim }}>
          {formatRelativeTime(observation.timestamp)}
        </span>
      </div>

      <div className={styles.summary} style={{ color: colors.white }}>
        {observation.summary}
      </div>

      {((observation.tags && observation.tags.length > 0) || observation.project) && (
        <div className={styles.tags}>
          {observation.project && (
            <span
              className={styles.tag}
              style={{
                color: colors.cyan,
                borderColor: colors.cyanDim,
                backgroundColor: 'rgba(6, 182, 212, 0.1)',
              }}
            >
              {observation.project}
            </span>
          )}
          {observation.tags?.map((tag) => (
            <span
              key={tag}
              className={styles.tag}
              style={{
                color: colors.cyan,
                borderColor: colors.cyanDim,
                backgroundColor: 'rgba(6, 182, 212, 0.1)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
