import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Tone, tint, tones } from '@/theme/tones';
import { usePressScale } from '@/components/motion/usePressScale';

export interface ActionItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: Tone;
  route: string;
}

function Cell({ item, onOpen }: { item: ActionItem; onOpen: (route: string) => void }) {
  const press = usePressScale(0.92);
  return (
    <Animated.View style={[styles.cellWrap, press.style]}>
      <TouchableOpacity style={styles.cell} onPress={() => onOpen(item.route)} onPressIn={press.onPressIn} onPressOut={press.onPressOut} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={item.label}>
        <View style={[styles.icon, { backgroundColor: tint(tones[item.tone], 0.84) }]}>
          <Ionicons name={item.icon} size={24} color={tones[item.tone]} />
        </View>
        <Text style={styles.label} numberOfLines={2}>{item.label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/** Shortcuts, four across: a rounded square in the tone's soft colour with its icon, and a short label under it. */
export function ActionGrid({ items, onOpen }: { items: readonly ActionItem[]; onOpen: (route: string) => void }) {
  return (
    <View style={styles.grid}>
      {items.map((a) => (
        <Cell key={a.label} item={a} onOpen={onOpen} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm, rowGap: spacing.base },
  cellWrap: { width: '25%' },
  cell: { alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.labelSmall, color: colors.text, textAlign: 'center', lineHeight: 14 },
});
