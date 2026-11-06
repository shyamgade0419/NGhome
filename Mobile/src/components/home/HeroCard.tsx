import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useBranding } from '@/hooks/useBranding';
import { colors, spacing } from '@/theme';
import { heroColors } from '@/theme/tones';

/**
 * The card at the top of a home screen: a gradient (the society's own colour if it has one) with a soft circle of light in
 * the corner, holding the one number that matters.
 */
export function HeroCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const brand = useBranding();
  return (
    <LinearGradient colors={heroColors(brand.color, colors.primary)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, style]}>
      <View style={styles.glow} pointerEvents="none" />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.base, marginTop: spacing.base, borderRadius: 24, padding: spacing.lg, overflow: 'hidden', gap: spacing.sm },
  glow: { position: 'absolute', right: -50, top: -60, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255,255,255,0.09)' },
});
