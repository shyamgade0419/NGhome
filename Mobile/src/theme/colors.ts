/**
 * Brand-aligned palette.
 *
 * `primary` and `primaryDark` are the exact navy used on the login screen,
 * splash screen and app icon (#0D2147 / #071428) — before this file, the rest
 * of the app (every button, active tab, badge, stat card across 48 files) ran
 * on a generic blue with no relationship to the brand, so the app looked
 * on-brand for exactly one screen and then switched identity after login.
 *
 * `secondary` and `success` are both the brand green (#3D8C3C) rather than two
 * separate greens: the same hue now means "paid / positive" everywhere,
 * whether it's a status badge or a collected-amount figure sitting next to one.
 */
export const colors = {
  primary: '#0D2147',
  primaryLight: '#E7EAF2',
  primaryDark: '#071428',

  // One shade darker than the raw brand green (#3D8C3C): visually identical,
  // but #3D8C3C sits at 4.19:1 against white — under WCAG AA's 4.5:1 for
  // normal text, though fine for bold/large text. This clears 5.00:1 cleanly
  // wherever the color appears as small badge text, not just large numerals.
  secondary: '#377E36',
  secondaryLight: '#E8F3E7',

  success: '#377E36',
  successLight: '#E8F3E7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

  // A hair cooler/darker than the old #F8FAFC, which sat close enough to
  // `surface` white that most screens read as flat white-on-white with
  // color only in the one navy hero card. This keeps things just as
  // light and clean but gives white cards a visible canvas to sit on.
  background: '#EEF1F8',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',

  border: '#E2E8F0',
  borderLight: '#F1F5F9',

  text: '#1E293B',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',
  textDisabled: '#CBD5E1',

  overlay: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0,0,0,0.08)',
} as const;

export type ColorKey = keyof typeof colors;
