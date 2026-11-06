import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Tone, tones } from '@/theme/tones';
import { EmptyBackdrop } from '@/components/illustrations/scenes';
import { FadeInUp } from '@/components/motion/FadeInUp';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The colour of the picture. By default one is chosen from the icon, so the same screen always looks the same. */
  tone?: Tone;
}

const TONES: Tone[] = ['teal', 'violet', 'blue', 'green', 'coral', 'amber'];

/** A stable colour for an icon name: the same empty screen is always the same colour, and different screens differ. */
export function toneForIcon(icon: string): Tone {
  let h = 7;
  for (let i = 0; i < icon.length; i += 1) h = (h * 31 + icon.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export function EmptyState({
  icon = 'document-outline',
  title,
  description,
  actionLabel,
  onAction,
  tone,
}: EmptyStateProps) {
  const chosen = tone ?? toneForIcon(icon);
  return (
    <View style={styles.container}>
      <FadeInUp>
        <View style={styles.picture}>
          <EmptyBackdrop tone={chosen} />
          <View style={styles.iconWrapper}>
            <Ionicons name={icon} size={36} color={tones[chosen]} />
          </View>
        </View>
      </FadeInUp>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} variant="outline" size="sm" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing['2xl'],
    gap: spacing.md,
  },
  picture: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  iconWrapper: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  title: {
    ...typography.headingSmall,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
