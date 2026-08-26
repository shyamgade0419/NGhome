import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, shadow, typography } from '@/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, style, onPress, padding = 'md' }: CardProps) {
  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[styles.card, styles[padding], style]}
      >
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, styles[padding], style]}>{children}</View>;
}

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  color?: string;
  onPress?: () => void;
}

export function StatCard({ label, value, subtitle, color = colors.primary, onPress }: StatCardProps) {
  return (
    <Card onPress={onPress} style={styles.statCard}>
      <View style={[styles.statIndicator, { backgroundColor: color }]} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.statSubtitle}>{subtitle}</Text>}
    </Card>
  );
}

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
  none: { padding: 0 },
  sm: { padding: spacing.md },
  md: { padding: spacing.base },
  lg: { padding: spacing.xl },

  statCard: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  statIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  statLabel: {
    ...typography.labelMedium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statValue: {
    ...typography.headingLarge,
    marginTop: spacing.xs,
  },
  statSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  sectionTitle: {
    ...typography.headingSmall,
    color: colors.text,
  },
  sectionAction: {
    ...typography.labelMedium,
    color: colors.primary,
  },
});
