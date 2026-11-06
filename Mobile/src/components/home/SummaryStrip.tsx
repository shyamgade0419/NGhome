import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '@/theme';
import { TintStatTile } from './TintStatTile';
import { FadeInUp } from '@/components/motion/FadeInUp';
import type { Tone } from '@/theme/tones';
import type { Ionicons } from '@expo/vector-icons';

export interface SummaryTile {
  key: string;
  tone: Tone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  subtitle?: string;
  /** Makes the tile a button, e.g. to show only that status. */
  onPress?: () => void;
}

/** Two or three figures at the top of a list screen, each on a soft card of its own colour. */
export function SummaryStrip({ tiles }: { tiles: SummaryTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <FadeInUp>
      <View style={styles.row}>
        {tiles.map(({ key, ...t }) => (
          <TintStatTile key={key} {...t} />
        ))}
      </View>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.xs },
});
