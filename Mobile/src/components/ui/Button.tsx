import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, spacing, radius, typography } from '@/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.base,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.textInverse}
        />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.label,
              styles[`${variant}Label` as keyof typeof styles],
              styles[`${size}Label` as keyof typeof styles],
              isDisabled && styles.disabledLabel,
              textStyle,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  fullWidth: { width: '100%' },

  // Variants
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.secondary },
  outline: { backgroundColor: 'transparent', borderColor: colors.primary },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: colors.error },

  // Disabled
  disabled: { opacity: 0.5 },

  // Sizes
  sm: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  md: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md - 2 },
  lg: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md },

  // Labels
  label: {
    ...typography.labelLarge,
    fontWeight: '600',
  },
  primaryLabel: { color: colors.textInverse },
  secondaryLabel: { color: colors.textInverse },
  outlineLabel: { color: colors.primary },
  ghostLabel: { color: colors.primary },
  dangerLabel: { color: colors.textInverse },

  disabledLabel: {},

  // Size labels
  smLabel: { fontSize: 13 },
  mdLabel: { fontSize: 14 },
  lgLabel: { fontSize: 16 },
});
