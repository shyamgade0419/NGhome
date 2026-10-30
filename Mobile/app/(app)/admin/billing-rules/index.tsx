/**
 * Admin — Billing Rules
 *
 * Rules decide how each flat's maintenance is calculated, so this screen is
 * deliberately conservative: creating a rule captures only the fields the API
 * requires, and deleting asks twice. Per-component breakdowns are shown but
 * edited on the web, where the nested form has room.
 *
 * calculationType values come from CALCULATION_TYPES, which mirrors the Prisma
 * enum. The DTO validates with @IsEnum — anything else is a 400.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  billingRulesApi,
  BillingRule,
  CALCULATION_TYPES,
} from '@/api/endpoints/billing-rules.api';
import { BASIS_LABEL, KIND_LABEL, buildRulePayload, describeRule } from '@/utils/billingRules';
import type { Basis, ChargeKind, RuleForm } from '@/utils/billingRules';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

// ── Create sheet ─────────────────────────────────────────────────────────────

function CreateRuleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [showDate, setShowDate] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState<RuleForm>({
    kind: 'MAINTENANCE',
    name: 'Monthly maintenance',
    basis: 'EQUAL_PER_FLAT',
    amount: '',
    installments: '1',
    startMonth: today.slice(0, 7),
    effectiveFrom: `${today.slice(0, 7)}-01`,
    effectiveTo: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => billingRulesApi.create(payload as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-rules'] });
      Alert.alert('Added', "The charge will appear on every flat's next bills.");
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to add the charge.'),
  });

  const corpus = form.kind === 'CORPUS';
  const n = Math.max(1, parseInt(form.installments || '1', 10) || 1);
  const value = parseFloat(form.amount);
  const each = Number.isFinite(value) && value > 0 ? Math.round((value / n) * 100) / 100 : 0;
  const unit = form.basis === 'EQUAL_PER_FLAT' ? '₹ per flat' : form.basis === 'AREA_BASED' ? '₹ per sq ft' : '₹ per resident';

  // Changing what the charge is also changes its suggested name, unless the person typed their own.
  const pickKind = (kind: ChargeKind) =>
    setForm((f) => {
      const suggested = (k: ChargeKind) => (k === 'MAINTENANCE' ? 'Monthly maintenance' : KIND_LABEL[k]);
      return { ...f, kind, name: !f.name || f.name === suggested(f.kind) ? suggested(kind) : f.name };
    });

  const submit = () => {
    const built = buildRulePayload(form);
    if ('error' in built) {
      Alert.alert('Check the charge', built.error);
      return;
    }
    mutation.mutate(built.payload);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Add a charge</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.ruleDesc}>
              Set it once here. Every flat&apos;s bill picks it up when bills are generated, so nothing is typed in the sheet.
            </Text>

            <Text style={styles.label}>What is this charge? *</Text>
            <View style={styles.typeGrid}>
              {(Object.keys(KIND_LABEL) as ChargeKind[]).map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.typeChip, form.kind === k && styles.typeChipActive]}
                  onPress={() => pickKind(k)}
                >
                  <Text style={[styles.typeText, form.kind === k && styles.typeTextActive]}>{KIND_LABEL[k]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Name on the bill *</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="e.g. Monthly maintenance"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.label}>How is it worked out? *</Text>
            <View style={styles.typeGrid}>
              {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
                <TouchableOpacity
                  key={b}
                  style={[styles.typeChip, form.basis === b && styles.typeChipActive]}
                  onPress={() => setForm((f) => ({ ...f, basis: b }))}
                >
                  <Text style={[styles.typeText, form.basis === b && styles.typeTextActive]}>{BASIS_LABEL[b]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{corpus ? `Total to collect (${unit}) *` : `Amount each month (${unit}) *`}</Text>
            <TextInput
              style={styles.input}
              value={form.amount}
              onChangeText={(v) => setForm((f) => ({ ...f, amount: v.replace(/[^0-9.]/g, '') }))}
              keyboardType="decimal-pad"
              placeholder={form.basis === 'EQUAL_PER_FLAT' ? '2500' : '2.50'}
              placeholderTextColor={colors.textTertiary}
            />

            {corpus ? (
              <>
                <Text style={styles.label}>Collect over (months)</Text>
                <TextInput
                  style={styles.input}
                  value={form.installments}
                  onChangeText={(v) => setForm((f) => ({ ...f, installments: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  placeholder="1 = in one go"
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.label}>First instalment in (YYYY-MM)</Text>
                <TextInput
                  style={styles.input}
                  value={form.startMonth}
                  onChangeText={(v) => setForm((f) => ({ ...f, startMonth: v.replace(/[^0-9-]/g, '').slice(0, 7) }))}
                  placeholder="2026-11"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                />
                {each > 0 ? (
                  <Text style={styles.ruleDesc}>
                    {n === 1
                      ? `Billed once, in the ${form.startMonth} bill.`
                      : `${each.toLocaleString('en-IN')} a month for ${n} months, starting ${form.startMonth}.`}{' '}
                    An amount not paid stays pending and carries into the next month.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.label}>Applies from *</Text>
                <TouchableOpacity style={styles.dateTouchable} onPress={() => setShowDate(true)} activeOpacity={0.7}>
                  <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.dateText}>
                    {new Date(form.effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                {showDate && (
                  <DateTimePicker
                    value={new Date(form.effectiveFrom)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      setShowDate(Platform.OS === 'ios');
                      if (d) setForm((f) => ({ ...f, effectiveFrom: d.toISOString().split('T')[0] }));
                    }}
                  />
                )}
                <Text style={styles.label}>Until (optional, YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={form.effectiveTo}
                  onChangeText={(v) => setForm((f) => ({ ...f, effectiveTo: v.replace(/[^0-9-]/g, '').slice(0, 10) }))}
                  placeholder="Leave blank to keep charging"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                />
              </>
            )}

            <Button
              label={mutation.isPending ? 'Adding…' : 'Add charge'}
              onPress={submit}
              loading={mutation.isPending}
              disabled={!form.name.trim() || !form.amount}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.base }}
            />
            <View style={{ height: spacing['3xl'] }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function BillingRulesScreen() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['billing-rules'],
    queryFn: billingRulesApi.list,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      billingRulesApi.toggle(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing-rules'] }),
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to update rule.'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => billingRulesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-rules'] });
      Alert.alert('Deleted', 'Billing rule removed.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to delete rule.'),
  });

  const confirmDelete = (rule: BillingRule) => {
    Alert.alert(
      'Delete Billing Rule',
      `"${rule.name}" will be removed. Bills already generated are unaffected, but future bills will no longer use this rule.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeMutation.mutate(rule.id) },
      ],
    );
  };

  const rules = data ?? [];

  const addButton = (
    <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={8} style={{ padding: 4 }}>
      <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Billing Rules" showBack rightAction={addButton} />

      {isLoading ? (
        <LoadingState message="Loading rules…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load rules" description="Pull down to retry." />
      ) : (
        <FlatList
          data={rules}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListHeaderComponent={
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={15} color={colors.info} />
              <Text style={styles.noticeText}>
                Rules determine how maintenance is calculated for each flat. Changes apply to bills
                generated from now on, not to bills already issued.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, !item.isActive && styles.cardInactive]}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleName}>{item.name}</Text>
                  {item.description ? <Text style={styles.ruleDesc}>{item.description}</Text> : null}
                  <Text style={[styles.ruleName, { fontSize: 13 }, describeRule(item).startsWith('No amount') && { color: colors.error }]}>
                    {describeRule(item)}
                  </Text>
                  <Text style={styles.ruleMeta}>
                    {CALCULATION_TYPES.find((t) => t.value === item.calculationType)?.label ??
                      item.calculationType?.replace(/_/g, ' ')}
                    {item.effectiveFrom
                      ? ` · from ${new Date(item.effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : ''}
                  </Text>
                  {item.priority > 0 ? (
                    <Text style={styles.ruleMeta}>Priority {item.priority}</Text>
                  ) : null}
                </View>
                <Switch
                  value={item.isActive}
                  onValueChange={(v) => toggleMutation.mutate({ id: item.id, isActive: v })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {(item.components?.length ?? 0) > 0 && (
                <View style={styles.componentBox}>
                  {item.components!.map((c) => (
                    <View key={c.id} style={styles.componentRow}>
                      <Text style={styles.componentName}>{c.name}</Text>
                      {c.amount ? (
                        <Text style={styles.componentAmount}>{inr(c.amount)}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={styles.deleteRow} onPress={() => confirmDelete(item)} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={14} color={colors.error} />
                <Text style={styles.deleteText}>Delete rule</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="options-outline"
              title="No billing rules"
              description="Tap + to add the rule that decides how maintenance is calculated."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.infoLight, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.info, flex: 1, lineHeight: 17 },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.md,
  },
  cardInactive: { opacity: 0.6 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  ruleName: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  ruleDesc: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  ruleMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 2 },

  componentBox: {
    backgroundColor: colors.background, borderRadius: radius.md,
    padding: spacing.md, gap: 6,
  },
  componentRow: { flexDirection: 'row', justifyContent: 'space-between' },
  componentName: { ...typography.bodySmall, color: colors.textSecondary },
  componentAmount: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },

  deleteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  deleteText: { ...typography.labelMedium, color: colors.error },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  modalBody: { padding: spacing.base },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  dateTouchable: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  dateText: { ...typography.bodyMedium, color: colors.text, flex: 1 },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeText: { ...typography.labelMedium, color: colors.textSecondary, fontSize: 12 },
  typeTextActive: { color: colors.primary },
});
