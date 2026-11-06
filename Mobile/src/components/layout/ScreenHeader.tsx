import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing, typography, shadow } from '@/theme';
import { Area, areaForTitle } from '@/theme/areas';
import { tint, tones } from '@/theme/tones';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  /** The colour and icon of the part of the app this screen belongs to. Chosen from the title when not given; null for none. */
  area?: Area | null;
}

export function ScreenHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightAction,
  area: areaProp,
}: ScreenHeaderProps) {
  const router = useRouter();
  const area = areaProp === undefined ? areaForTitle(title) : areaProp;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.header, area && { borderBottomWidth: 2, borderBottomColor: tint(tones[area.tone], 0.55), backgroundColor: tint(tones[area.tone], 0.94) }]}>
      <View style={styles.left}>
        {showBack && (
          <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={8}>
            <View style={styles.backCircle}>
              <Ionicons name="chevron-back" size={18} color={colors.primary} />
            </View>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.center}>
        <View style={styles.titleRow}>
          {area && (
            <View style={[styles.areaChip, { backgroundColor: tones[area.tone] }]}>
              <Ionicons name={area.icon} size={15} color="#FFFFFF" />
            </View>
          )}
          <Text style={[styles.title, styles.titleText]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      <View style={styles.right}>{rightAction}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadow.sm,
  },
  left: {
    width: 40,
    alignItems: 'flex-start',
  },
  backCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  right: {
    // minWidth (not a fixed width) keeps icon-only right actions symmetric
    // with the 40-wide back-button column, but lets a wider rightAction —
    // e.g. a labeled <Button> like Water Readings' "Save" — size to its
    // own content instead of being crushed to 40px and wrapping character
    // by character.
    minWidth: 40,
    alignItems: 'flex-end',
  },
  backButton: {
    padding: spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  areaChip: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  titleText: { flexShrink: 1 },
  title: {
    ...typography.headingSmall,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
