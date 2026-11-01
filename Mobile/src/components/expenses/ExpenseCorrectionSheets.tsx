/**
 * Correcting an expense on the phone: the edit form (with the comment an approved or paid expense needs) and
 * the list of corrections already made. Drawn in the screen's own view tree rather than as native Modals, for
 * the same reason as the reject and mark-paid sheets beside them.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { expensesApi } from '@/api/endpoints/expenses.api';
import { colors, radius, spacing, typography } from '@/theme';
import { inr } from '@/utils/format';
import {
  EXPENSE_CATEGORIES, categoryChoices, changedFields, describeChanges, editValuesOf, paidAmountEffect, validateEdit,
  type ExpenseEditValues, type ExpenseLike, type HistoryEntry,
} from '@/utils/expenseCorrections';

export interface CorrectableExpense extends ExpenseLike {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  linkedEntityType?: string | null;
  account?: { id: string; name: string } | null;
  fund?: { id: string; name: string } | null;
}

/** A full-screen dim with a bottom card; the hardware back button closes it. */
function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={s.overlay}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.avoid}>
        <View style={s.card}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={s.header}>
      <Text style={s.title}>{title}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel="Close">
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

export function EditExpenseSheet({ expense, onClose }: { expense: CorrectableExpense; onClose: () => void }) {
  const qc = useQueryClient();
  const posted = expense.status !== 'PENDING';
  const eventLinked = expense.linkedEntityType === 'EVENT';
  const [form, setForm] = useState<ExpenseEditValues>(() => editValuesOf(expense));
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDate, setShowDate] = useState(false);
  const set = (key: keyof ExpenseEditValues) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => expensesApi.update(expense.id, body),
    onSuccess: () => {
      for (const key of ['expenses', 'accounts', 'funds', 'fund-summary']) qc.invalidateQueries({ queryKey: [key] });
      onClose();
      // After the sheet has gone, so the alert is not raised in the same instant as it closes.
      setTimeout(() => Alert.alert(posted ? 'Correction saved' : 'Saved', posted ? 'The change and your comment are recorded.' : 'The expense was updated.'), 300);
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      setError(Array.isArray(m) ? m.join(', ') : (m ?? 'Could not save the change.'));
    },
  });

  const submit = () => {
    if (mutation.isPending) return;
    const problem = validateEdit(form, posted, comment);
    if (problem) { setError(problem); return; }
    const body = changedFields(expense, form);
    if (Object.keys(body).length === 0) { setError('Nothing has changed yet.'); return; }
    setError(null);
    mutation.mutate({ ...body, ...(comment.trim() ? { reason: comment.trim() } : {}) });
  };

  const effect = paidAmountEffect(expense.status, expense.amount, form.amount, expense.account?.name ?? null, expense.fund?.name ?? null);
  const categories = categoryChoices(EXPENSE_CATEGORIES, editValuesOf(expense).category);
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(form.expenseDate) ? new Date(`${form.expenseDate}T12:00:00`) : new Date();

  return (
    <Overlay onClose={onClose}>
      <Header title={posted ? 'Correct Expense' : 'Edit Expense'} onClose={onClose} />
      <ScrollView keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={{ gap: spacing.sm }}>
        {posted && (
          <View style={s.notice}>
            <Text style={s.noticeText}>
              This expense is already {expense.status.toLowerCase()}. A correction is recorded with your name and your
              comment, and the old values are kept in the audit log.
            </Text>
          </View>
        )}

        <Text style={s.label}>Description</Text>
        <TextInput style={s.input} value={form.description} onChangeText={set('description')} accessibilityLabel="Expense description" />

        <Text style={s.label}>Amount (₹)</Text>
        <TextInput
          style={[s.input, eventLinked && s.inputOff]}
          value={form.amount}
          onChangeText={(v) => set('amount')(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          editable={!eventLinked}
          accessibilityLabel="Expense amount"
        />
        {eventLinked && (
          <Text style={s.hint}>
            This came from an event, so its amount is set there. To change it, undo the recording on the event and record it again.
          </Text>
        )}
        {effect && <Text style={s.effect}>{effect}</Text>}

        <Text style={s.label}>Date</Text>
        <TouchableOpacity style={[s.input, s.dateRow]} onPress={() => setShowDate(true)} accessibilityLabel="Expense date">
          <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
          <Text style={s.dateText}>
            {new Date(`${form.expenseDate}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </TouchableOpacity>
        {showDate && (
          <DateTimePicker
            value={dateValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_: DateTimePickerEvent, date?: Date) => {
              setShowDate(Platform.OS === 'ios');
              if (date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                set('expenseDate')(`${y}-${m}-${d}`);
              }
            }}
          />
        )}

        <Text style={s.label}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {categories.map((cat) => {
            const on = form.category.toLowerCase() === cat.toLowerCase();
            return (
              <TouchableOpacity key={cat} style={[s.chip, on && s.chipOn]} onPress={() => set('category')(cat)} accessibilityLabel={`Category ${cat}`}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{cat.replace(/_/g, ' ')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={s.label}>Vendor / Payee</Text>
        <TextInput style={s.input} value={form.vendorPayee} onChangeText={set('vendorPayee')} placeholder="Optional" placeholderTextColor={colors.textTertiary} accessibilityLabel="Vendor" />

        <Text style={s.label}>Invoice number</Text>
        <TextInput style={s.input} value={form.invoiceNumber} onChangeText={set('invoiceNumber')} placeholder="Optional" placeholderTextColor={colors.textTertiary} accessibilityLabel="Invoice number" />

        <Text style={s.label}>{posted ? 'Comment: why is this being corrected? *' : 'Comment (optional)'}</Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={comment}
          onChangeText={setComment}
          placeholder={posted ? 'e.g. The invoice was for ₹2,500, I typed ₹2,000' : 'Anything worth noting'}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={500}
          textAlignVertical="top"
          accessibilityLabel="Correction comment"
        />

        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      </ScrollView>

      <View style={s.actions}>
        <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.saveBtn, mutation.isPending && { opacity: 0.6 }]} onPress={submit} disabled={mutation.isPending} accessibilityLabel="Save correction">
          <Text style={s.saveText}>{mutation.isPending ? 'Saving…' : posted ? 'Save correction' : 'Save changes'}</Text>
        </TouchableOpacity>
      </View>
    </Overlay>
  );
}

export function ExpenseHistorySheet({ expense, onClose }: { expense: CorrectableExpense; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['expense-history', expense.id],
    queryFn: () => expensesApi.history(expense.id),
  });

  return (
    <Overlay onClose={onClose}>
      <Header title="Corrections" onClose={onClose} />
      <Text style={s.desc}>{expense.description} · {inr(expense.amount, { decimals: true })}</Text>
      <ScrollView style={s.scroll} contentContainerStyle={{ gap: spacing.sm }}>
        {isLoading ? (
          <Text style={s.hint}>Loading…</Text>
        ) : isError ? (
          <Text style={s.error}>Could not load the corrections.</Text>
        ) : !data?.length ? (
          <Text style={s.hint}>No corrections recorded.</Text>
        ) : (
          data.map((h: HistoryEntry) => (
            <View key={h.id} style={s.entry}>
              <Text style={s.entryMeta}>
                {new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {h.by ? ` · ${h.by}` : ''}
              </Text>
              {describeChanges(h.changes).map((line) => <Text key={line} style={s.entryLine}>{line}</Text>)}
              {h.reason ? <Text style={s.entryReason}>“{h.reason}”</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    </Overlay>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  avoid: { justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.xl, gap: spacing.md, maxHeight: '92%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.headingSmall, color: colors.text },
  desc: { ...typography.bodySmall, color: colors.textSecondary },
  scroll: { flexGrow: 0 },
  notice: { backgroundColor: colors.warningLight, borderRadius: radius.md, padding: spacing.md },
  noticeText: { ...typography.bodySmall, color: colors.text },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.xs },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, ...typography.bodyMedium, color: colors.text,
  },
  inputOff: { opacity: 0.5 },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  effect: { ...typography.bodySmall, color: colors.text, backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md },
  error: { ...typography.bodySmall, color: colors.error },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginRight: 8 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelText: { ...typography.labelLarge, color: colors.textSecondary },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { ...typography.labelLarge, color: '#fff', fontWeight: '600' },
  entry: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  entryMeta: { ...typography.labelSmall, color: colors.textSecondary },
  entryLine: { ...typography.bodyMedium, color: colors.text },
  entryReason: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
});
