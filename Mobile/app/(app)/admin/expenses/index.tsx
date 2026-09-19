import React, { useEffect, useState } from 'react';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { accountsApi } from '@/api/endpoints/accounts.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

interface Expense {
  id: string;
  categoryName: string;
  description: string;
  amount: string;
  expenseDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  payeeName: string | null;
  notes: string | null;
  createdAt: string;
}

const CATEGORIES = [
  'MAINTENANCE', 'UTILITIES', 'SECURITY', 'HOUSEKEEPING', 'REPAIRS',
  'ADMINISTRATIVE', 'EVENTS', 'EQUIPMENT', 'LANDSCAPING', 'INSURANCE', 'OTHER',
];

function expenseStatusVariant(status: string) {
  switch (status) {
    case 'APPROVED': return 'success' as const;
    case 'PAID':     return 'primary' as const;
    case 'PENDING':  return 'warning' as const;
    case 'REJECTED': return 'error' as const;
    default:         return 'neutral' as const;
  }
}

// ── Add Expense Sheet ─────────────────────────────────────────────────────────
function AddExpenseModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [showExpenseDatePicker, setShowExpenseDatePicker] = useState(false);
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: CATEGORIES[0],
    expenseDate: new Date().toISOString().slice(0, 10),
    vendorPayee: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post('/expenses', {
        description: form.description.trim(),
        amount: parseFloat(form.amount),
        category: form.category,
        expenseDate: form.expenseDate,
        vendorPayee: form.vendorPayee.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      // Close the sheet first and raise the alert once its slide-out has
      // finished — showing both in the same instant is what could wedge
      // Android's native modal layer for whatever opened next.
      onClose();
      setTimeout(() => Alert.alert('Added', 'Expense recorded successfully.'), 400);
      setForm({
        description: '', amount: '', category: CATEGORIES[0],
        expenseDate: new Date().toISOString().slice(0, 10),
        vendorPayee: '', notes: '',
      });
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to add expense.'),
  });

  const canSubmit = form.description.trim().length > 0 && parseFloat(form.amount) > 0;

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe} edges={['top', 'bottom']}>
        <View style={modal.header}>
          <Text style={modal.title}>Add Expense</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={modal.content} keyboardShouldPersistTaps="handled">
            {/* Category picker */}
            <Text style={modal.label}>Category *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={modal.chipScroll}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[modal.chip, form.category === cat && modal.chipActive]}
                  onPress={() => set('category')(cat)}
                >
                  <Text style={[modal.chipText, form.category === cat && modal.chipTextActive]}>
                    {cat.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={modal.label}>Description *</Text>
            <TextInput
              style={modal.input}
              value={form.description}
              onChangeText={set('description')}
              placeholder="e.g. Plumber repair work"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Amount (₹) *</Text>
            <TextInput
              style={modal.input}
              value={form.amount}
              onChangeText={set('amount')}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Date *</Text>
            <TouchableOpacity
              style={[modal.input, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
              onPress={() => setShowExpenseDatePicker(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={{ ...typography.bodyMedium, color: colors.text, flex: 1 }}>
                {new Date(form.expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showExpenseDatePicker && (
              <DateTimePicker
                value={new Date(form.expenseDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                onChange={(_: DateTimePickerEvent, date?: Date) => {
                  setShowExpenseDatePicker(Platform.OS === 'ios');
                  if (date) set('expenseDate')(date.toISOString().slice(0, 10));
                }}
              />
            )}

            <Text style={modal.label}>Vendor / Payee</Text>
            <TextInput
              style={modal.input}
              value={form.vendorPayee}
              onChangeText={set('vendorPayee')}
              placeholder="Optional"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={modal.label}>Notes</Text>
            <TextInput
              style={[modal.input, modal.textarea]}
              value={form.notes}
              onChangeText={set('notes')}
              placeholder="Optional remarks"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Button
              label={mutation.isPending ? 'Saving…' : 'Save Expense'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.md }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * A bottom sheet drawn inside this screen's own view tree instead of a
 * native <Modal>. The reject and mark-paid sheets are opened right after
 * "Add Expense", which closes its own native Modal and pops an Alert in
 * the same instant — on Android that can leave the native modal layer in
 * a state where later Modals silently never present (the Mark Paid sheet
 * simply didn't open). An in-tree overlay has no native window to get
 * stuck, and behaves identically on both platforms. The hardware back
 * button still dismisses it, as a Modal's onRequestClose did.
 */
function InlineSheet({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (!visible) return null;
  return <View style={rejectModal.inline}>{children}</View>;
}

// ── Main screen ───────────────────────────────────────────────────────────────
const STATUS_FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
type Filter = typeof STATUS_FILTERS[number];

export default function ExpensesScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [showAdd, setShowAdd] = useState(false);
  // Android-compatible reject modal (replaces Alert.prompt which is iOS-only)
  const [rejectingExpense, setRejectingExpense] = useState<Expense | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payingExpense, setPayingExpense] = useState<Expense | null>(null);
  const [payAccountId, setPayAccountId] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['expenses', filter],
    queryFn: async () => {
      const params: Record<string, unknown> = { limit: 50 };
      if (filter !== 'ALL') params.status = filter;
      const res = await apiClient.get<{ data: Expense[]; meta: unknown }>('/expenses', { params });
      return res.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/expenses/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      Alert.alert('Approved', 'Expense has been approved.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to approve.'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/expenses/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      Alert.alert('Rejected', 'Expense has been rejected.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to reject.'),
  });

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      apiClient.post(`/expenses/${id}/mark-paid`, { accountId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setPayingExpense(null);
      setPayAccountId(null);
      Alert.alert('Marked Paid', 'The account balance has been updated.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to mark paid.'),
  });

  // Opening the sheet always starts from a clean choice. With exactly one
  // account there is nothing to choose between, so it is preselected — the
  // same "only when it isn't a guess" rule payment auto-approval applies;
  // with several, the admin has to pick, and the sheet says so.
  const openPayModal = (item: Expense) => {
    setPayAccountId(accounts && accounts.length === 1 ? accounts[0].id : null);
    setPayingExpense(item);
  };

  // The confirm button used to be `disabled` until an account was tapped,
  // and only dimmed slightly — pressing it did nothing, with no message,
  // which read as the feature being broken. It now always responds.
  const confirmMarkPaid = () => {
    if (!payingExpense || markPaidMutation.isPending) return;
    if (!accounts || accounts.length === 0) {
      Alert.alert(
        'No account to pay from',
        'Add a bank account or cash box under Accounts first — marking an expense paid deducts it from an account.',
      );
      return;
    }
    if (!payAccountId) {
      Alert.alert('Choose an account', 'Tap the account this expense was paid from, then confirm.');
      return;
    }
    markPaidMutation.mutate({ id: payingExpense.id, accountId: payAccountId });
  };

  const handleApprove = (item: Expense) => {
    Alert.alert(
      'Approve Expense',
      `Approve ${inr(item.amount)} for "${item.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => approveMutation.mutate(item.id) },
      ],
    );
  };

  const handleReject = (item: Expense) => {
    // Alert.prompt is iOS-only — use a cross-platform modal instead
    setRejectReason('');
    setRejectingExpense(item);
  };

  const confirmReject = () => {
    if (!rejectingExpense) return;
    if (!rejectReason.trim()) {
      Alert.alert('Required', 'Please provide a reason for rejection.');
      return;
    }
    rejectMutation.mutate(
      { id: rejectingExpense.id, reason: rejectReason.trim() },
      { onSettled: () => setRejectingExpense(null) },
    );
  };

  const renderItem = ({ item }: { item: Expense }) => (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <Text style={styles.category}>{item.categoryName?.replace(/_/g, ' ')}</Text>
          <Text style={styles.description} numberOfLines={1}>{item.description}</Text>
          {item.payeeName ? <Text style={styles.payee}>{item.payeeName}</Text> : null}
          {item.notes ? (
            <Text style={styles.notes} numberOfLines={1}>{item.notes}</Text>
          ) : null}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.amount}>{inr(item.amount)}</Text>
          <Text style={styles.date}>
            {new Date(item.expenseDate).toLocaleDateString('en-IN')}
          </Text>
          <StatusBadge label={item.status} variant={expenseStatusVariant(item.status)} size="sm" />
        </View>
      </View>

      {/* Approve / Reject for PENDING */}
      {item.status === 'PENDING' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => handleApprove(item)}
          >
            <Ionicons name="checkmark-circle-outline" size={15} color={colors.success} />
            <Text style={[styles.actionText, { color: colors.success }]}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => handleReject(item)}
          >
            <Ionicons name="close-circle-outline" size={15} color={colors.error} />
            <Text style={[styles.actionText, { color: colors.error }]}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Approving commits the expense but moves no money — marking it paid is
          the only thing that debits an account. Without this the balance kept
          showing spent money as still available. */}
      {item.status === 'APPROVED' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => openPayModal(item)}
          >
            <Ionicons name="cash-outline" size={15} color={colors.success} />
            <Text style={[styles.actionText, { color: colors.success }]}>Mark Paid</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );

  const addButton = (
    <TouchableOpacity
      onPress={() => setShowAdd(true)}
      hitSlop={8}
      style={{ padding: 4 }}
    >
      <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Expenses" rightAction={addButton} />

      {/* Status filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
      >
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <LoadingState message="Loading expenses…" />
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title="No expenses"
              description={filter === 'ALL' ? 'Tap + to record a new expense.' : `No ${filter.toLowerCase()} expenses.`}
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      <AddExpenseModal visible={showAdd} onClose={() => setShowAdd(false)} />

      {/* Cross-platform rejection reason modal (replaces Alert.prompt) */}
      <InlineSheet visible={!!rejectingExpense} onRequestClose={() => setRejectingExpense(null)}>
        <View style={rejectModal.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={rejectModal.card}>
              <View style={rejectModal.header}>
                <Text style={rejectModal.title}>Reject Expense</Text>
                <TouchableOpacity onPress={() => setRejectingExpense(null)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              {rejectingExpense && (
                <Text style={rejectModal.desc}>
                  {rejectingExpense.description} · {inr(rejectingExpense.amount)}
                </Text>
              )}
              <TextInput
                style={rejectModal.input}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="Reason for rejection…"
                placeholderTextColor={colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={rejectModal.actions}>
                <TouchableOpacity style={rejectModal.cancelBtn} onPress={() => setRejectingExpense(null)}>
                  <Text style={rejectModal.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[rejectModal.rejectBtn, rejectMutation.isPending && { opacity: 0.6 }]}
                  onPress={confirmReject}
                  disabled={rejectMutation.isPending}
                >
                  <Text style={rejectModal.rejectText}>
                    {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </InlineSheet>

      {/* Which account the money actually leaves. Reuses the rejection modal's
          shape rather than a full page sheet — it's one choice and a confirm. */}
      <InlineSheet visible={!!payingExpense} onRequestClose={() => setPayingExpense(null)}>
        <View style={rejectModal.overlay}>
          <View style={rejectModal.card}>
            <View style={rejectModal.header}>
              <Text style={rejectModal.title}>Mark Paid</Text>
              <TouchableOpacity onPress={() => setPayingExpense(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {payingExpense && (
              <Text style={rejectModal.desc}>
                {payingExpense.description} · {inr(payingExpense.amount)}
              </Text>
            )}
            <Text style={payModal.label}>Pay from account</Text>
            {(accounts ?? []).length === 0 ? (
              <Text style={payModal.emptyAccounts}>
                No accounts yet. Add a bank account or cash box under Accounts, then come back to mark this paid.
              </Text>
            ) : null}
            <ScrollView style={payModal.accountList}>
              {(accounts ?? []).map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[payModal.accountRow, payAccountId === a.id && payModal.accountRowActive]}
                  onPress={() => setPayAccountId(a.id)}
                >
                  <Ionicons
                    name={payAccountId === a.id ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={payAccountId === a.id ? colors.primary : colors.textTertiary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={payModal.accountName}>{a.name}</Text>
                    <Text style={payModal.accountBal}>{inr(a.currentBalance)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={payModal.hint}>
              Deducts this amount from the account and records it in that account&apos;s ledger.
            </Text>
            <View style={rejectModal.actions}>
              <TouchableOpacity style={rejectModal.cancelBtn} onPress={() => setPayingExpense(null)}>
                <Text style={rejectModal.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[payModal.confirmBtn, markPaidMutation.isPending && { opacity: 0.6 }]}
                onPress={confirmMarkPaid}
                disabled={markPaidMutation.isPending}
              >
                <Text style={payModal.confirmText}>
                  {markPaidMutation.isPending ? 'Saving…' : 'Mark Paid'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </InlineSheet>
    </SafeAreaView>
  );
}

const payModal = StyleSheet.create({
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  accountList: { maxHeight: 200 },
  accountRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 6,
  },
  accountRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  accountName: { ...typography.bodyMedium, color: colors.text },
  accountBal: { ...typography.bodySmall, color: colors.textSecondary },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginTop: spacing.sm },
  emptyAccounts: { ...typography.bodySmall, color: colors.warning },
  confirmBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  confirmText: { ...typography.labelLarge, color: colors.textInverse },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  filterBar: { borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 48 },
  filterContent: { paddingHorizontal: spacing.base, paddingVertical: 8, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.labelMedium, color: colors.textSecondary },
  filterTextActive: { color: '#fff' },

  list: { padding: spacing.base },
  card: { gap: spacing.sm },

  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: 'flex-end', gap: 3 },

  category: { ...typography.labelLarge, color: colors.primary },
  description: { ...typography.bodyMedium, color: colors.text, fontWeight: '500' },
  payee: { ...typography.bodySmall, color: colors.textSecondary },
  notes: { ...typography.bodySmall, color: colors.textTertiary, fontStyle: 'italic' },
  amount: { ...typography.headingSmall, color: colors.text },
  date: { ...typography.bodySmall, color: colors.textSecondary },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1,
  },
  approveBtn: { borderColor: colors.success, backgroundColor: colors.successLight ?? colors.background },
  rejectBtn:  { borderColor: colors.error,   backgroundColor: colors.errorLight },
  actionText: { ...typography.labelMedium, fontWeight: '600' },
});

const rejectModal = StyleSheet.create({
  // Above the list and header, below nothing — the sheet is part of the screen.
  inline: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.xl,
    gap: spacing.md,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...typography.headingSmall, color: colors.text },
  desc: { ...typography.bodySmall, color: colors.textSecondary },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelText: { ...typography.labelLarge, color: colors.textSecondary },
  rejectBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  rejectText: { ...typography.labelLarge, color: '#fff', fontWeight: '600' },
});

const modal = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  content: { padding: spacing.base, gap: spacing.sm },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },

  chipScroll: { marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
});
