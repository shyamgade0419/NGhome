import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Tone, tint, tones } from '@/theme/tones';

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
    <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      {body}
    </TouchableOpacity>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: 18, borderWidth: 1, padding: spacing.md, gap: 2 },
  chip: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  label: { ...typography.labelSmall, color: colors.textSecondary },
  value: { ...typography.headingSmall, color: colors.text, fontWeight: '800' },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  track: { height: 5, borderRadius: 3, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});
