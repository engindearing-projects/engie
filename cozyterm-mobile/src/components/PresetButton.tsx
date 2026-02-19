import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  label: string;
  onPress: () => void;
  active?: boolean;
}

export function PresetButton({ label, onPress, active }: Props) {
  return (
    <TouchableOpacity
      style={[styles.button, active && styles.active]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.bgLight,
  },
  active: {
    backgroundColor: colors.cyan,
  },
  label: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '500',
  },
  activeLabel: {
    color: colors.bg,
  },
});
