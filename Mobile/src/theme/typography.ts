import { Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  android: {
    regular: 'Roboto',
    medium: 'Roboto',
    semibold: 'Roboto',
    bold: 'Roboto',
  },
  default: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
});

export const typography = {
  displayLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700' as const,
    fontFamily: fontFamily?.bold,
    letterSpacing: -0.5,
  },
  displaySmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700' as const,
    fontFamily: fontFamily?.bold,
    letterSpacing: -0.3,
  },
  headingLarge: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700' as const,
    fontFamily: fontFamily?.bold,
  },
  headingMedium: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600' as const,
    fontFamily: fontFamily?.semibold,
  },
  headingSmall: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
    fontFamily: fontFamily?.semibold,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    fontFamily: fontFamily?.regular,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    fontFamily: fontFamily?.regular,
  },
  bodySmall: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400' as const,
    fontFamily: fontFamily?.regular,
  },
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    fontFamily: fontFamily?.medium,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    fontFamily: fontFamily?.medium,
    letterSpacing: 0.2,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
    fontFamily: fontFamily?.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  monospace: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
} as const;
