import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { fonts } from '@/theme/typography';
import { Tone, tint, tones } from '@/theme/tones';
import { usePressScale } from '@/components/motion/usePressScale';

interface Props {
  tone: Tone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  subtitle?: string;
  /** 0 to 1: draws a thin progress bar under the figure. */
  progress?: number;
  onPress?: () => void;
}

/** One figure on a soft card of its own colour, with an icon chip: the colour tells what kind of figure it is. */
export function TintStatTile({ tone, icon, label, value, subtitle, progress, onPress }: Props) {
  const color = tones[tone];
  const press = usePressScale();
  const body = (
    <>
      <View style={[styles.chip, { backgroundColor: color }]}>
        <Ionicons name={icon} size={18} color="#FFFFFF" />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {progress !== undefined && (
        <View style={[styles.track, { backgroundColor: tint(color, 0.78) }]}>
          <View style={[styles.fill, { backgroundColor: color, width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
        </View>
      )}
    </>
  );
  const style = [styles.tile, { backgroundColor: tint(color, 0.88), borderColor: tint(color, 0.74) }];
  return onPress ? (
    <Animated.View style={[styles.cell, press.style]}>
      <TouchableOpacity style={style} onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
        {body}
      </TouchableOpacity>
    </Animated.View>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1 },
  tile: { flex: 1, borderRadius: 18, borderWidth: 1, padding: spacing.md, gap: 2 },
  chip: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  label: { ...typography.labelSmall, color: colors.textSecondary },
  value: { ...typography.headingSmall, fontFamily: fonts.extrabold, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  track: { height: 5, borderRadius: 3, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
