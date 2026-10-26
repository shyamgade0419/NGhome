import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useBranding } from '@/hooks/useBranding';
import { spacing, typography } from '@/theme';

/**
 * The society's logo and app name, for the top of a home screen. Draws nothing
 * for a society that has no branding, so unbranded screens are unchanged.
 */
export function BrandMark() {
  const brand = useBranding();
  if (!brand.logoUri && !brand.appName) return null;

  return (
    <View style={styles.row} accessibilityRole="header">
      {brand.logoUri ? <Image source={{ uri: brand.logoUri }} style={styles.logo} resizeMode="contain" /> : null}
      {brand.appName ? (
        <Text style={[styles.name, { color: brand.color }]} numberOfLines={1}>
          {brand.appName}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  logo: { width: 22, height: 22, borderRadius: 5 },
  name: { ...typography.labelMedium, fontWeight: '700', flexShrink: 1 },
});
