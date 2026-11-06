import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/theme';
import { deepen, tint, tones } from '@/theme/tones';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

// A soft tint of the status colour behind a dot in the colour itself and text darkened for contrast.
const variantConfig: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: { bg: tint(tones.green, 0.86), text: deepen(tones.green, 0.45), dot: tones.green },
  warning: { bg: tint(tones.amber, 0.86), text: deepen(tones.amber, 0.4), dot: tones.amber },
  error: { bg: colors.errorLight, text: colors.error, dot: colors.error },
  info: { bg: tint(tones.blue, 0.88), text: deepen(tones.blue, 0.3), dot: tones.blue },
  neutral: { bg: colors.surfaceSecondary, text: colors.textSecondary, dot: colors.textTertiary },
  primary: { bg: colors.primaryLight, text: colors.primary, dot: colors.primary },
};

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

export function StatusBadge({ label, variant = 'neutral', size = 'md' }: StatusBadgeProps) {
  const config = variantConfig[variant];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, size === 'sm' && styles.sm]}>
      <View style={[styles.dot, { backgroundColor: config.dot }]} />
      <Text numberOfLines={1} style={[styles.label, { color: config.text }, size === 'sm' && styles.smLabel]}>
        {label}
      </Text>
    </View>
  );
}

export function paymentStatusVariant(
  status: string,
): BadgeVariant {
  switch (status) {
    case 'APPROVED': return 'success';
    case 'PENDING': return 'warning';
    case 'UNDER_REVIEW': return 'info';
    case 'REJECTED': return 'error';
    case 'CANCELLED': return 'neutral';
    default: return 'neutral';
  }
}

export function billingStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'PUBLISHED': return 'primary';
    case 'PAID': return 'success';
    case 'PARTIALLY_PAID': return 'warning';
    case 'CLOSED': return 'neutral';
    case 'DRAFT': return 'neutral';
    case 'CALCULATED': return 'info';
    default: return 'neutral';
  }
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  label: {
    ...typography.labelMedium,
    fontWeight: '600',
  },
  smLabel: {
    fontSize: 10,
  },
});
