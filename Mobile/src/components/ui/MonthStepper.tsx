import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '@/theme';
import { isAfter, monthTitle, shiftMonth, type YearMonth } from '@/reports/residentReports';

/** ‹ November 2026 ›: step back through the months, and forward as far as this month and no further. */
export function MonthStepper({ month, now, onChange, style }: { month: YearMonth; now: YearMonth; onChange: (m: YearMonth) => void; style?: StyleProp<ViewStyle> }) {
  const canGoForward = !isAfter(shiftMonth(month, 1), now);
  return (
    <View style={[styles.stepper, style]}>
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.btn}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.title}>{monthTitle(month)}</Text>
      <TouchableOpacity
        onPress={() => canGoForward && onChange(shiftMonth(month, 1))}
        disabled={!canGoForward}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !canGoForward }}
        style={[styles.btn, !canGoForward && { opacity: 0.35 }]}
      >
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headingSmall, color: colors.text },
});
