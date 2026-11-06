import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tone, tint, tones } from '@/theme/tones';

/**
 * A bottom-tab icon. The tab you are on gets a soft pill in its own colour with the icon in that colour; the others stay
 * grey. Each tab has one colour, the same one its screens use inside.
 */
export function TabIcon({ name, tone, focused, color, size = 22 }: { name: React.ComponentProps<typeof Ionicons>['name']; tone: Tone; focused: boolean; color: string; size?: number }) {
  return (
    <View style={[styles.pill, focused && { backgroundColor: tint(tones[tone], 0.84) }]}>
      <Ionicons name={name} size={size} color={focused ? tones[tone] : color} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { width: 50, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
