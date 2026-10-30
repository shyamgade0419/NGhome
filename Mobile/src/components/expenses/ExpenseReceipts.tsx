import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { expensesApi } from '@/api/endpoints/expenses.api';
import { colors, spacing, typography, radius } from '@/theme';
import {
  ExpenseStatus, MAX_RECEIPTS, Receipt, StoredReceipt,
  canAddReceiptTo, canRemoveReceiptFrom, isPdf, receiptCountLabel, receiptProblem,
} from '@/utils/receipts';
import { takePhoto, chooseFile } from './receiptCapture';

const messageOf = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/**
 * The receipts of one saved expense, on its card: tap one to open it, add another (camera or file),
 * or remove one. Adding is open to every expense but a rejected one — a bill often turns up after
 * the fact — and removing stops once the expense is paid.
 */
export function ExpenseReceipts({
  expenseId,
  status,
  receipts,
}: {
  expenseId: string;
  status: ExpenseStatus;
  receipts: StoredReceipt[];
}) {
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const canAdd = canAddReceiptTo(status) && receipts.length < MAX_RECEIPTS;
  const canRemove = canRemoveReceiptFrom(status);

  const upload = useMutation({
    mutationFn: (receipt: Receipt) => expensesApi.uploadReceipt(expenseId, receipt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (e) => Alert.alert('Receipt not added', messageOf(e, 'The receipt could not be uploaded. Check your connection and try again.')),
  });

  const remove = useMutation({
    mutationFn: (receiptId: string) => expensesApi.removeReceipt(expenseId, receiptId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (e) => Alert.alert('Receipt not removed', messageOf(e, 'The receipt could not be removed. Please try again.')),
  });

  const add = async (capture: () => Promise<Receipt | null>) => {
    try {
      const receipt = await capture();
      if (!receipt) return;
      const problem = receiptProblem(receipt, receipts.length);
      if (problem) {
        Alert.alert('Cannot add this', problem);
        return;
      }
      upload.mutate(receipt);
    } catch {
      Alert.alert('Could not add it', 'Something went wrong opening the camera or the file. Please try again.');
    }
  };

  const chooseSource = () =>
    Alert.alert('Add a receipt', undefined, [
      { text: 'Take photo', onPress: () => void add(takePhoto) },
      { text: 'Photo or PDF from phone', onPress: () => void add(chooseFile) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const open = async (r: StoredReceipt) => {
    if (opening) return;
    setOpening(r.id);
    try {
      await expensesApi.openReceipt(expenseId, r);
    } catch {
      Alert.alert('Could not open it', 'The receipt could not be downloaded. Check your connection and try again.');
    } finally {
      setOpening(null);
    }
  };

  const confirmRemove = (r: StoredReceipt) =>
    Alert.alert('Remove this receipt?', r.fileName, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(r.id) },
    ]);

  // Nothing to show and nothing to add (a rejected expense with no receipts): leave the card as it was.
  if (receipts.length === 0 && !canAdd) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.count}>{receiptCountLabel(receipts.length)}</Text>
        {canAdd ? (
          <TouchableOpacity
            style={[styles.addBtn, upload.isPending && { opacity: 0.6 }]}
            onPress={chooseSource}
            disabled={upload.isPending}
            accessibilityLabel="Add a receipt"
          >
            <Ionicons name="camera-outline" size={15} color={colors.primary} />
            <Text style={styles.addText}>{upload.isPending ? 'Uploading…' : 'Add receipt'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {receipts.map((r) => (
        <View key={r.id} style={styles.chip}>
          <TouchableOpacity style={styles.chipMain} onPress={() => open(r)} accessibilityLabel={`Open ${r.fileName}`}>
            <Ionicons name={isPdf(r.mimeType) ? 'document-text-outline' : 'image-outline'} size={18} color={colors.primary} />
            <Text style={styles.chipName} numberOfLines={1}>{opening === r.id ? 'Opening…' : r.fileName}</Text>
          </TouchableOpacity>
          {canRemove ? (
            <TouchableOpacity onPress={() => confirmRemove(r)} hitSlop={8} accessibilityLabel={`Remove ${r.fileName}`}>
              <Ionicons name="close-circle-outline" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { ...typography.labelMedium, color: colors.textSecondary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.primary,
  },
  addText: { ...typography.labelMedium, color: colors.primary, fontWeight: '600' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  chipMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipName: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
