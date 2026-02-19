import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import type { UnreadState } from '../hooks/useActivitySync';

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
    <View style={styles.banner}>
      <View style={styles.content}>
        <Text style={styles.header}>
          {unread.unreadCount} update{unread.unreadCount !== 1 ? 's' : ''} from{' '}
          {platforms.join(', ')}
        </Text>
        {displayItems.map((item) => (
          <Text key={item.id} style={styles.item} numberOfLines={1}>
            <Text style={styles.platform}>{item.platform}</Text>{' '}
            {item.content.slice(0, 80)}
            {item.content.length > 80 ? '...' : ''}
          </Text>
        ))}
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={8}>
        <Text style={styles.dismiss}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: colors.bgLight,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  header: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.cyan,
  },
  item: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.gray,
  },
  platform: {
    fontWeight: '600',
    color: colors.cyanDim,
    textTransform: 'capitalize',
  },
  dismiss: {
    fontSize: 18,
    color: colors.grayDim,
    paddingHorizontal: 2,
  },
});
