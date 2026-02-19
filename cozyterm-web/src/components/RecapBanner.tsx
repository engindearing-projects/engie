import { useMemo } from 'react';
import { colors } from '../theme/colors';
import type { UnreadState } from '../hooks/useActivitySync';
import styles from './RecapBanner.module.css';

interface RecapBannerProps {
  unread: UnreadState;
  onDismiss: () => void;
}

export function RecapBanner({ unread, onDismiss }: RecapBannerProps) {
  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const item of unread.latest) {
      set.add(item.platform);
    }
    return [...set];
  }, [unread.latest]);

  const displayItems = unread.latest.slice(0, 3);

  return (
    <div className={styles.banner} style={{ backgroundColor: colors.bgLight }}>
      <div className={styles.content}>
        <div className={styles.header} style={{ color: colors.cyan }}>
          {unread.unreadCount} update{unread.unreadCount !== 1 ? 's' : ''} from{' '}
          {platforms.join(', ')}
        </div>
        {displayItems.map((item) => (
          <div key={item.id} className={styles.item} style={{ color: colors.gray }}>
            <span className={styles.platform} style={{ color: colors.cyanDim }}>
              {item.platform}
            </span>{' '}
            {item.content.slice(0, 80)}{item.content.length > 80 ? '...' : ''}
          </div>
        ))}
      </div>
      <button
        className={styles.dismiss}
        style={{ color: colors.grayDim }}
        onClick={onDismiss}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
