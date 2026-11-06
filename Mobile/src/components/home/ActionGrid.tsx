import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Tone, tint, tones } from '@/theme/tones';

export interface ActionItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: Tone;
  route: string;
}

/** Shortcuts, four across: a rounded square in the tone's soft colour with its icon, and a short label under it. */
export function ActionGrid({ items, onOpen }: { items: readonly ActionItem[]; onOpen: (route: string) => void }) {
  return (
    <View style={styles.grid}>
      {items.map((a) => (
        <TouchableOpacity key={a.label} style={styles.cell} onPress={() => onOpen(a.route)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={a.label}>
          <View style={[styles.icon, { backgroundColor: tint(tones[a.tone], 0.84) }]}>
            <Ionicons name={a.icon} size={24} color={tones[a.tone]} />
          </View>
          <Text style={styles.label} numberOfLines={2}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm, rowGap: spacing.base },
  cell: { width: '25%', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.labelSmall, color: colors.text, textAlign: 'center', lineHeight: 14 },
});
