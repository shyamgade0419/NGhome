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
  CalculationType,
  CALCULATION_TYPES,
} from '@/api/endpoints/billing-rules.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

// ── Create sheet ─────────────────────────────────────────────────────────────

function CreateRuleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [showDate, setShowDate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    calculationType: 'EQUAL_PER_FLAT' as CalculationType,
    effectiveFrom: new Date().toISOString().split('T')[0],
    priority: '0',
  });

  const mutation = useMutation({
    mutationFn: () =>
      billingRulesApi.create({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        calculationType: form.calculationType,
        // The DTO wants an ISO datetime, not a bare date string.
        effectiveFrom: new Date(form.effectiveFrom).toISOString(),
        priority: parseInt(form.priority || '0', 10),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing-rules'] });
      Alert.alert('Created', 'Billing rule added.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to create rule.'),
  });

  const canSubmit = form.name.trim().length > 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Billing Rule</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Rule Name *</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="e.g. Standard Maintenance"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={styles.input}
              value={form.description}
              onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Optional"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={styles.label}>Calculation Type *</Text>
            <View style={styles.typeGrid}>
              {CALCULATION_TYPES.map((t) => {
                const active = form.calculationType === t.value;
                return (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.typeChip, active && styles.typeChipActive]}
                    onPress={() => setForm((f) => ({ ...f, calculationType: t.value }))}
                  >
                    <Text style={[styles.typeText, active && styles.typeTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Effective From *</Text>
            <TouchableOpacity style={styles.dateTouchable} onPress={() => setShowDate(true)} activeOpacity={0.7}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>
                {new Date(form.effectiveFrom).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
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

            <Text style={styles.label}>Priority</Text>
            <TextInput
              style={styles.input}
              value={form.priority}
              onChangeText={(v) => setForm((f) => ({ ...f, priority: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              placeholder="0 = default"
              placeholderTextColor={colors.textTertiary}
            />

            <Button
              label={mutation.isPending ? 'Creating…' : 'Create Rule'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
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
                        <Text style={styles.componentAmount}>
                          ₹{parseFloat(c.amount).toLocaleString('en-IN')}
                        </Text>
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
