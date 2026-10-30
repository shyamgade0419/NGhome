import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, radius } from '@/theme';
import { Receipt, MAX_RECEIPTS, isPdf, receiptProblem } from '@/utils/receipts';
import { takePhoto, chooseFile } from './receiptCapture';

/**
 * The receipts chosen on the "Add Expense" form — photographed or picked, shown with a thumbnail and
 * removable until the expense is saved. Nothing is sent from here; the form sends them once the
 * expense exists.
 */
export function ReceiptPicker({
  receipts,
  onChange,
  disabled,
}: {
  receipts: Receipt[];
  onChange: (next: Receipt[]) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const full = receipts.length >= MAX_RECEIPTS;

  const add = async (capture: () => Promise<Receipt | null>) => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const receipt = await capture();
      if (!receipt) return;
      const problem = receiptProblem(receipt, receipts.length);
      if (problem) {
        Alert.alert('Cannot add this', problem);
        return;
      }
      onChange([...receipts, receipt]);
    } catch {
      Alert.alert('Could not add it', 'Something went wrong opening the camera or the file. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, (full || busy) && styles.btnOff]}
          onPress={() => add(takePhoto)}
          disabled={full || busy || disabled}
          accessibilityLabel="Take a photo of the bill"
        >
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
          <Text style={styles.btnText}>Take photo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, (full || busy) && styles.btnOff]}
          onPress={() => add(chooseFile)}
          disabled={full || busy || disabled}
          accessibilityLabel="Attach a photo or PDF from the phone"
        >
          <Ionicons name="attach-outline" size={20} color={colors.primary} />
          <Text style={styles.btnText}>Photo or PDF</Text>
        </TouchableOpacity>
      </View>

      {receipts.map((r, i) => (
        <View key={`${r.uri}-${i}`} style={styles.row}>
          {isPdf(r.mimeType) ? (
            <View style={[styles.thumb, styles.pdfThumb]}>
              <Ionicons name="document-text" size={22} color={colors.primary} />
            </View>
          ) : (
            <Image source={{ uri: r.uri }} style={styles.thumb} />
          )}
          <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
          <TouchableOpacity
            onPress={() => onChange(receipts.filter((_, j) => j !== i))}
            hitSlop={8}
            disabled={disabled}
            accessibilityLabel={`Remove ${r.name}`}
          >
            <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.hint}>
        {full ? `That is the most — ${MAX_RECEIPTS} receipts.` : 'Optional. Photograph the bill so whoever approves it can see what was bought.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  btnOff: { opacity: 0.5 },
  btnText: { ...typography.labelLarge, color: colors.primary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.background },
  pdfThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  name: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  hint: { ...typography.bodySmall, color: colors.textTertiary },
});
