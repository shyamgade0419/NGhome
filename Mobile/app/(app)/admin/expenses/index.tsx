import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';

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
      Alert.alert('Added', 'Expense recorded successfully.');
      onClose();
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
            <TextInput
              style={modal.input}
              value={form.expenseDate}
              onChangeText={set('expenseDate')}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              keyboardType="numbers-and-punctuation"
            />

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

// ── Main screen ───────────────────────────────────────────────────────────────
const STATUS_FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;
type Filter = typeof STATUS_FILTERS[number];

export default function ExpensesScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [showAdd, setShowAdd] = useState(false);

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

  const handleApprove = (item: Expense) => {
    Alert.alert(
      'Approve Expense',
      `Approve ₹${parseFloat(item.amount).toLocaleString('en-IN')} for "${item.description}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => approveMutation.mutate(item.id) },
      ],
    );
  };

  const handleReject = (item: Expense) => {
    Alert.prompt(
      'Reject Expense',
      'Enter reason for rejection:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: (reason) => {
            if (!reason?.trim()) {
              Alert.alert('Required', 'Please provide a reason.');
              return;
            }
            rejectMutation.mutate({ id: item.id, reason: reason.trim() });
          },
        },
      ],
      'plain-text',
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
          <Text style={styles.amount}>₹{parseFloat(item.amount).toLocaleString('en-IN')}</Text>
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
    </SafeAreaView>
  );
}

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
