import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '@/theme/typography';
import { Tone, tint, tones } from '@/theme/tones';

interface Props {
  tone: Tone;
  /** An icon, or `text` (initials, a number) in its place. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  text?: string;
  size?: number;
}

/** A rounded square in a tone's soft colour holding an icon or a couple of letters: the mark at the start of a list row. */
export function IconChip({ tone, icon, text, size = 40 }: Props) {
  const color = tones[tone];
  return (
    <View style={[styles.chip, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: tint(color, 0.84) }]}>
      {icon ? (
        <Ionicons name={icon} size={Math.round(size * 0.5)} color={color} />
      ) : (
        <Text style={[styles.text, { color, fontSize: Math.round(size * 0.36) }]} numberOfLines={1}>{(text ?? '').slice(0, 2).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.bold },
});
