import React from 'react';
import { SafeAreaView as PlatformSafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { isGlass } from '@/theme/look';
import { GlassBackdrop } from './GlassBackdrop';

/**
 * The screen container every screen uses in place of react-native-safe-area-context's own SafeAreaView. With the classic look it
 * is exactly that; with the glass look it also draws the aurora behind its content (the glass palette's background is transparent
 * so the aurora shows). One place, so no screen has to know which look it is in.
 */
export function SafeAreaView({ children, ...props }: SafeAreaViewProps) {
  if (!isGlass) return <PlatformSafeAreaView {...props}>{children}</PlatformSafeAreaView>;
  return (
    <PlatformSafeAreaView {...props}>
      <GlassBackdrop />
      {children}
    </PlatformSafeAreaView>
  );
}
