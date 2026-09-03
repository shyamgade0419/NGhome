import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '@/theme';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

const variantConfig: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: colors.successLight, text: colors.success },
  warning: { bg: colors.warningLight, text: '#B45309' },
  error: { bg: colors.errorLight, text: colors.error },
  info: { bg: colors.infoLight, text: colors.info },
  neutral: { bg: colors.surfaceSecondary, text: colors.textSecondary },
  primary: { bg: colors.primaryLight, text: colors.primary },
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
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
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
