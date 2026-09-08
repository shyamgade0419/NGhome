import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, billingStatusVariant } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod, billingPeriodName } from '@/types/billing.types';
import { inr } from '@/utils/format';

/** Last calendar day of a month — handles 28/29/30/31 without a lookup table
 *  (day 0 of the *next* month is the last day of this one). */
function lastDayOfMonth(year: number, month1to12: number): Date {
  return new Date(year, month1to12, 0);
}

/**
 * Creating a billing period was reachable from the backend (POST /billing/
 * periods) and from web, but had no mobile UI at all — the empty state told
 * admins to "create your first billing period" and then offered no way to do
 * it, so billing could never be started from the phone.
 *
 * Web asks for all five values as separate fields (year, month, start, end,
 * due). That's a lot of typing on a phone and easy to get subtly wrong — a
 * start date in the wrong month, or an end date that isn't the month's last
 * day. Here the month is the only real choice: start and end are derived from
 * it, shown read-only so nothing is hidden, and only the due date stays
 * editable since that's genuine society policy rather than arithmetic.
 */
function CreatePeriodModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const now = new Date();
  const [periodDate, setPeriodDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  // Default due date follows the common convention of the 10th of the month
  // being billed; admins who bill in arrears just move it forward.
  const [dueDate, setDueDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 10),
  );
  const [notes, setNotes] = useState('');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);
  const [showDuePicker, setShowDuePicker] = useState(false);

  const periodYear = periodDate.getFullYear();
  const periodMonth = periodDate.getMonth() + 1;
  const startDate = new Date(periodYear, periodDate.getMonth(), 1);
  const endDate = lastDayOfMonth(periodYear, periodMonth);

  const mutation = useMutation({
    mutationFn: () =>
      billingApi.createBillingPeriod({
        periodYear,
        periodMonth,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-periods'] });
      Alert.alert(
        'Period Created',
        'Next: generate bills for this period, then publish it so residents can see them.',
      );
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to create billing period.'),
  });

  const fmtLong = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Billing Period</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Billing Month *</Text>
            <TouchableOpacity
              style={styles.dateTouchable}
              onPress={() => setShowPeriodPicker(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>
                {periodDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showPeriodPicker && (
              <DateTimePicker
                value={periodDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowPeriodPicker(Platform.OS === 'ios');
                  if (d) setPeriodDate(new Date(d.getFullYear(), d.getMonth(), 1));
                }}
              />
            )}

            <View style={styles.derivedBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.derivedText}>
                Covers {fmtLong(startDate)} to {fmtLong(endDate)}
              </Text>
            </View>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Payment Due Date *</Text>
            <TouchableOpacity
              style={styles.dateTouchable}
              onPress={() => setShowDuePicker(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>{fmtLong(dueDate)}</Text>
            </TouchableOpacity>
            {showDuePicker && (
              <DateTimePicker
                value={dueDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowDuePicker(Platform.OS === 'ios');
                  if (d) setDueDate(d);
                }}
              />
            )}

            <Text style={[styles.label, { marginTop: spacing.base }]}>Notes</Text>
            <Text style={styles.hint}>Optional — shown with the period internally.</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Includes annual lift AMC recovery"
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Button
              label={mutation.isPending ? 'Creating…' : 'Create Period'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function MaintenanceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['billing-periods'],
    queryFn: () => billingApi.getBillingPeriods({ limit: 20 }),
  });

  const generateMutation = useMutation({
    mutationFn: billingApi.generateBills,
    onSuccess: (result, _periodId) => {
      Alert.alert(
        'Bills Generated',
        `Generated: ${result.generated} bills\nErrors: ${result.errors}`,
      );
      queryClient.invalidateQueries({ queryKey: ['billing-periods'] });
    },
    onError: () => Alert.alert('Error', 'Failed to generate bills.'),
  });

  const publishMutation = useMutation({
    mutationFn: billingApi.publishPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-periods'] });
      Alert.alert('Published', 'Billing period published. Residents can now view their bills.');
    },
    onError: () => Alert.alert('Error', 'Failed to publish period.'),
  });

  const renderItem = ({ item }: { item: BillingPeriod }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push(`/(app)/admin/billing/${item.id}` as any)}
    >
      {/* Drill-in indicator */}
      <View style={styles.drillRow}>
        <Text style={styles.drillHint}>Tap for bill details</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </View>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text style={styles.periodName}>{billingPeriodName(item)}</Text>
          <Text style={styles.periodDue}>
            Due: {new Date(item.dueDate).toLocaleDateString('en-IN')}
          </Text>
        </View>
        <StatusBadge label={item.status} variant={billingStatusVariant(item.status)} />
      </View>

      <View style={styles.amountsRow}>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Billed</Text>
          <Text style={[styles.amountValue, { color: colors.primary }]}>
            {inr(item.totalBilled)}
          </Text>
        </View>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Collected</Text>
          <Text style={[styles.amountValue, { color: colors.secondary }]}>
            {inr(item.totalCollected)}
          </Text>
        </View>
        <View style={styles.amount}>
          <Text style={styles.amountLabel}>Outstanding</Text>
          <Text style={[styles.amountValue, { color: colors.warning }]}>
            {inr(item.totalPending)}
          </Text>
        </View>
      </View>

      {(item.status === 'DRAFT' || item.status === 'CALCULATED') && (
        <View style={styles.cardActions}>
          <Button
            label="Generate Bills"
            onPress={() =>
              Alert.alert('Generate Bills', `Generate bills for ${billingPeriodName(item)}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Generate', onPress: () => generateMutation.mutate(item.id) },
              ])
            }
            loading={generateMutation.isPending}
            variant="outline"
            size="sm"
            style={styles.flex1}
          />
          {item.status === 'CALCULATED' && (
            <Button
              label="Publish"
              onPress={() =>
                Alert.alert('Publish Period', 'Publish this billing period to residents?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Publish', onPress: () => publishMutation.mutate(item.id) },
                ])
              }
              loading={publishMutation.isPending}
              size="sm"
              style={styles.flex1}
            />
          )}
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Billing & Maintenance"
        rightAction={
          <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={12}>
            <Ionicons name="add" size={26} color={colors.primary} />
          </TouchableOpacity>
        }
      />
      {isLoading ? (
        <LoadingState message="Loading billing periods..." />
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
              icon="receipt-outline"
              title="No billing periods yet"
              description="Create your first billing period to start generating maintenance bills."
              actionLabel="Create Billing Period"
              onAction={() => setShowCreate(true)}
            />
          }
        />
      )}
      {showCreate && <CreatePeriodModal onClose={() => setShowCreate(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  drillRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 2,
    marginBottom: -4,
  },
  drillHint: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 10 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: { flex: 1, marginRight: spacing.md },
  periodName: { ...typography.headingSmall, color: colors.text },
  periodDue: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  amountsRow: { flexDirection: 'row', gap: spacing.md },
  amount: { flex: 1, alignItems: 'center' },
  amountLabel: { ...typography.labelSmall, color: colors.textSecondary },
  amountValue: { ...typography.headingSmall, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text, flex: 1 },
  modalBody: { padding: spacing.base, gap: spacing.sm },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  dateTouchable: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  dateText: { ...typography.bodyMedium, color: colors.text },
  derivedBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    marginTop: spacing.sm,
  },
  derivedText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
