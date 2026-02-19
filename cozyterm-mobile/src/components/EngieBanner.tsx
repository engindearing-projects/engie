import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export function EngieBanner() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>EN</Text>
      <Text style={styles.title}>E N G I E</Text>
      <Text style={styles.subtitle}>Your AI project manager</Text>
      <Text style={styles.hint}>Type a message to get started</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  logo: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.cyan,
    letterSpacing: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.white,
    letterSpacing: 6,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 14,
    color: colors.gray,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: colors.grayDim,
  },
});
