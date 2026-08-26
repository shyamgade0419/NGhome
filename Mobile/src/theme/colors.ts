export const colors = {
  primary: '#1B4FFF',
  primaryLight: '#EEF2FF',
  primaryDark: '#1338CC',

  secondary: '#00C49A',
  secondaryLight: '#E6F9F4',

  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

  background: '#F8FAFC',
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
