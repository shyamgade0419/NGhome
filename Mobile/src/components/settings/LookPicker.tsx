import React, { useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { appliedLook, chosenLook, saveLook, type Look } from '@/theme/look';

const OPTIONS: { value: Look; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'glass', label: 'Glass', hint: 'Frosted cards over a soft glow', icon: 'water-outline' },
  { value: 'classic', label: 'Classic', hint: 'The flat, warm look', icon: 'layers-outline' },
];

/**
 * Glass or Classic. The app's colours are fixed when it opens, so a new choice is kept and applied the next time the app starts; this
 * says so, and on Android offers to close the app right away so the next open is the new look.
 */
export function LookPicker() {
  const [chosen, setChosen] = useState<Look>(chosenLook());
  const waiting = chosen !== appliedLook;

  const choose = (look: Look) => {
    setChosen(look);
    void saveLook(look);
  };

  return (
    <Card style={s.card}>
      <Text style={s.title}>Look of the app</Text>
      <View style={s.row}>
        {OPTIONS.map((o) => {
          const on = chosen === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => choose(o.value)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${o.label} look`}
              style={[s.option, on && s.optionOn]}
            >
              <Ionicons name={o.icon} size={20} color={on ? colors.primary : colors.textSecondary} />
              <Text style={[s.optionLabel, on && s.optionLabelOn]}>{o.label}</Text>
              <Text style={s.optionHint}>{o.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {waiting && (
        <View style={s.note} accessibilityLiveRegion="polite">
          <Text style={s.noteText}>Your new look shows the next time you open the app.</Text>
          {Platform.OS === 'android' && <Button label="Close the app now" onPress={() => BackHandler.exitApp()} variant="outline" size="sm" />}
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { gap: spacing.md },
  title: { ...typography.headingSmall, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    gap: 4,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionLabel: { ...typography.labelLarge, color: colors.textSecondary },
  optionLabelOn: { color: colors.primary },
  optionHint: { ...typography.bodySmall, color: colors.textSecondary },
  note: { gap: spacing.sm },
  noteText: { ...typography.bodySmall, color: colors.textSecondary },
});
