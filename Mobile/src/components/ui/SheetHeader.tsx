import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Area, areaForTitle } from '@/theme/areas';
import { tint, tones } from '@/theme/tones';

interface Props {
  title: string;
  onClose: () => void;
  /** The colour and icon of the form. Chosen from the title when not given; null for none. */
  area?: Area | null;
}

/**
 * The top of a pop-up form: its coloured chip, its title in the heading font, and a round close button. Every form shares
 * it, so a form opened from Payments looks like Payments (green) and one from Billing like Billing (blue).
 */
export function SheetHeader({ title, onClose, area: areaProp }: Props) {
  const area = areaProp === undefined ? areaForTitle(title) : areaProp;
  return (
    <View style={[styles.header, area && { backgroundColor: tint(tones[area.tone], 0.94), borderBottomColor: tint(tones[area.tone], 0.55), borderBottomWidth: 2 }]}>
      {area && (
        <View style={[styles.chip, { backgroundColor: tones[area.tone] }]}>
          <Ionicons name={area.icon} size={16} color="#FFFFFF" />
        </View>
      )}
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
        <Ionicons name="close" size={18} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chip: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headingSmall, color: colors.text, flex: 1 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(43,38,32,0.07)', alignItems: 'center', justifyContent: 'center' },
});
