import React from 'react';
import {
  Animated,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, radius, typography } from '@/theme';
import { isGlass } from '@/theme/look';
import { usePressScale } from '@/components/motion/usePressScale';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

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
  const press = usePressScale(0.97);
  // Glass look: the solid navy / green fill becomes a gradient with a light sheen across the top half.
  const glossy = isGlass && (variant === 'primary' || variant === 'secondary');

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[
        styles.base,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        glossy && styles.glossy,
        isDisabled && styles.disabled,
        style,
        press.style,
      ]}
    >
      {glossy && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={variant === 'primary' ? ['#24406B', '#0D2147', '#0B4F6C'] : ['#4AA249', '#2F6E2E', '#0F766E']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.3)', 'rgba(255,255,255,0)']}
            style={styles.sheen}
          />
        </>
      )}
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.textInverse}
        />
      ) : (
        <>
          {icon}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
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
    </AnimatedTouchable>
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
  glossy: {
    overflow: 'hidden',
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#0D2147',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 0,
  },
  sheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '52%' },

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
