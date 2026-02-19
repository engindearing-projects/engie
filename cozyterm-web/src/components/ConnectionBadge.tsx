import { colors } from '../theme/colors';
import type { ConnectionState } from '../types/gateway';
import styles from './ConnectionBadge.module.css';

interface Props {
  state: ConnectionState;
}

const config: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: colors.green, label: 'Connected' },
  connecting: { color: colors.yellow, label: 'Connecting...' },
  disconnected: { color: colors.red, label: 'Disconnected' },
};

export function ConnectionBadge({ state }: Props) {
  const { color, label } = config[state];

  return (
    <div className={styles.badge}>
      <span className={styles.dot} style={{ backgroundColor: color }} />
      <span className={styles.label} style={{ color: colors.gray }}>
        {label}
      </span>
    </div>
  );
}
