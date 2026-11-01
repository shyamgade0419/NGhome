import React, { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountsApi } from '@/api/endpoints/accounts.api';
import { paymentsApi } from '@/api/endpoints/payments.api';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { MaintenanceBill } from '@/types/billing.types';
import { inr, toNum } from '@/utils/format';
import { validPaymentDate } from '@/utils/reminders';

const METHODS: { value: string; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The admin or accountant records that a flat has paid: cash handed over, a cheque, a transfer seen in the bank.
 * One step on the server — the money goes into the chosen account and the flat's oldest unpaid months are settled
 * first — so there is no separate "approve" afterwards.
 */
export function RecordPaymentModal({ bill, periodId, onClose }: { bill: MaintenanceBill; periodId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const pending = toNum(bill.pendingAmount);
  const [amount, setAmount] = useState(String(pending));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  // With a single account there is nothing to choose.
  const accountId = pickedAccount ?? (accounts && accounts.length === 1 ? accounts[0].id : null);

  const mutation = useMutation({
    mutationFn: () =>
      paymentsApi.recordPayment({
        maintenanceBillId: bill.id,
        accountId: accountId as string,
        amount: Number(amount),
        paymentDate: date,
        paymentMethod: method,
        ...(reference.trim() ? { utrNumber: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-period', periodId] });
      qc.invalidateQueries({ queryKey: ['billing-period-bills-mobile', periodId] });
      qc.invalidateQueries({ queryKey: ['billing-period-reminders', periodId] });
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      Alert.alert('Marked as paid', `Flat ${bill.flatCode} is recorded as paid and the resident has been told.`);
      onClose();
    },
    onError: (e: any) => Alert.alert('Could not record it', e?.response?.data?.message ?? 'Try again.'),
  });

  const submit = () => {
    if (!(Number(amount) > 0)) return Alert.alert('Check the details', 'Enter an amount greater than zero.');
    if (!validPaymentDate(date)) return Alert.alert('Check the details', 'Enter the date it was paid as YYYY-MM-DD, not in the future.');
    if (!accountId) return Alert.alert('Check the details', 'Choose the account the money went into.');
    mutation.mutate();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Mark Flat {bill.flatCode} as paid</Text>
            <Text style={s.meta}>{inr(pending, { decimals: true })} still to pay · invoice {bill.invoiceNumber}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Amount received (₹) *</Text>
            <TextInput
              style={s.input}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Amount"
            />

            <Text style={[s.label, s.gap]}>Date paid (YYYY-MM-DD) *</Text>
            <TextInput
              style={s.input}
              value={date}
              onChangeText={setDate}
              placeholder="2026-10-05"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              accessibilityLabel="Date paid"
            />

            <Text style={[s.label, s.gap]}>Paid by *</Text>
            <View style={s.chips}>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[s.chip, method === m.value && s.chipOn]}
                  onPress={() => setMethod(m.value)}
                  accessibilityLabel={`Paid by ${m.label}`}
                >
                  <Text style={[s.chipText, method === m.value && s.chipTextOn]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.label, s.gap]}>Money went into *</Text>
            <View style={s.chips}>
              {(accounts ?? []).map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[s.chip, accountId === a.id && s.chipOn]}
                  onPress={() => setPickedAccount(a.id)}
                  accessibilityLabel={`Into ${a.name}`}
                >
                  <Text style={[s.chipText, accountId === a.id && s.chipTextOn]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
              {accounts && accounts.length === 0 && <Text style={s.hint}>Add a bank account first (Accounts).</Text>}
            </View>

            <Text style={[s.label, s.gap]}>Reference / UTR / cheque number (optional)</Text>
            <TextInput
              style={s.input}
              value={reference}
              onChangeText={setReference}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              accessibilityLabel="Reference"
            />

            <Text style={[s.label, s.gap]}>Note (optional)</Text>
            <TextInput
              style={s.input}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Cash handed to the secretary"
              placeholderTextColor={colors.textTertiary}
              maxLength={500}
              accessibilityLabel="Note"
            />

            <Text style={[s.hint, s.gap]}>
              This adds the amount to the chosen account and settles the bill. Older unpaid months of this flat are
              cleared first; anything above what it owes is kept as advance credit. The resident is told it was
              received.
            </Text>

            <View style={s.gap}>
              <Button label="Mark as paid" onPress={submit} loading={mutation.isPending} fullWidth />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  title: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  body: { padding: spacing.base, paddingBottom: spacing['3xl'] },
  label: { ...typography.labelLarge, color: colors.text, marginBottom: spacing.xs },
  gap: { marginTop: spacing.base },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.bodyMedium, color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.text },
  chipTextOn: { color: colors.textInverse },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
});
