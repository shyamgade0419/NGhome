/**
 * Admin — Water Billing Model Configuration
 *
 * The backend only ever exposes create + list for /water/configs (no
 * update or delete route exists) — which matches effectiveFrom/effectiveTo:
 * a rate change is a new config effective from a date, not an edit of the
 * old one. SOCIETY_ALLOCATION is excluded from the picker here since the
 * existing Water Readings screen's batch-allocation flow auto-creates and
 * reuses its own config; this screen is for the other, per-flat-metered
 * models (Per-KL, slab-based, fixed+usage, etc).
 *
 * Note: configuring a model here doesn't yet complete the billing flow —
 * there's still no per-flat "record a reading against this config" screen
 * on either client (only the Society Allocation batch entry exists). This
 * sets up the rate book; recording individual readings against it is a
 * separate, not-yet-built piece.
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
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  waterApi,
  WaterBillingConfig,
  ConfigurableWaterBillingModel,
  WaterSlab,
} from '@/api/endpoints/water.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

const MODELS: { value: ConfigurableWaterBillingModel; label: string }[] = [
  { value: 'PER_KL', label: 'Per KL' },
  { value: 'PER_LITRE', label: 'Per Litre' },
  { value: 'FIXED_CHARGE', label: 'Fixed Charge' },
  { value: 'FIXED_PLUS_USAGE', label: 'Fixed + Usage' },
  { value: 'SLAB_BASED', label: 'Slab Based' },
];

function modelLabel(model: string): string {
  return MODELS.find((m) => m.value === model)?.label ?? model.replace(/_/g, ' ');
}

/** One-line summary of a config's rate, read straight from its config JSON. */
function rateSummary(config: WaterBillingConfig): string {
  const c = config.config as Record<string, any>;
  switch (config.billingModel) {
    case 'PER_KL':
      return `${inr(c.ratePerKL)} / KL`;
    case 'PER_LITRE':
      return `${inr(c.ratePerLitre)} / litre`;
    case 'FIXED_CHARGE':
      return `${inr(c.fixedAmount)} flat`;
    case 'FIXED_PLUS_USAGE':
      return `${inr(c.fixedAmount)} + ${inr(c.ratePerKL)}/KL over ${c.minimumKL ?? 0} KL`;
    case 'SLAB_BASED': {
      const slabs = (c.slabs ?? []) as WaterSlab[];
      return slabs.map((s) => `up to ${s.upTo} KL @ ${inr(s.rate)}`).join(' · ') || 'No slabs set';
    }
    case 'SOCIETY_ALLOCATION':
      return 'Rate computed per period from actual costs';
    default:
      return '—';
  }
}

// ── Create config ────────────────────────────────────────────────────────

function CreateConfigModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [model, setModel] = useState<ConfigurableWaterBillingModel>('PER_KL');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [showDate, setShowDate] = useState(false);

  // Model-specific fields — kept as plain strings, parsed on submit.
  const [ratePerKL, setRatePerKL] = useState('');
  const [ratePerLitre, setRatePerLitre] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [minimumKL, setMinimumKL] = useState('');
  const [slabs, setSlabs] = useState<{ upTo: string; rate: string }[]>([{ upTo: '', rate: '' }]);

  const mutation = useMutation({
    mutationFn: () => {
      let config: Record<string, number | WaterSlab[]> = {};
      if (model === 'PER_KL') config = { ratePerKL: parseFloat(ratePerKL) || 0 };
      else if (model === 'PER_LITRE') config = { ratePerLitre: parseFloat(ratePerLitre) || 0 };
      else if (model === 'FIXED_CHARGE') config = { fixedAmount: parseFloat(fixedAmount) || 0 };
      else if (model === 'FIXED_PLUS_USAGE') {
        config = {
          fixedAmount: parseFloat(fixedAmount) || 0,
          ratePerKL: parseFloat(ratePerKL) || 0,
          minimumKL: parseFloat(minimumKL) || 0,
        };
      } else if (model === 'SLAB_BASED') {
        config = {
          slabs: slabs
            .filter((s) => s.upTo && s.rate)
            .map((s) => ({ upTo: parseFloat(s.upTo), rate: parseFloat(s.rate) })),
        };
      }
      return waterApi.createConfig({
        name: name.trim(),
        billingModel: model,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        config,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['water-configs'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save configuration.'),
  });

  const canSubmit = (() => {
    if (!name.trim()) return false;
    if (model === 'PER_KL') return !!ratePerKL;
    if (model === 'PER_LITRE') return !!ratePerLitre;
    if (model === 'FIXED_CHARGE') return !!fixedAmount;
    if (model === 'FIXED_PLUS_USAGE') return !!fixedAmount && !!ratePerKL;
    if (model === 'SLAB_BASED') return slabs.some((s) => s.upTo && s.rate);
    return false;
  })();

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Water Billing Config</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Standard Per-KL Rate 2026"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Billing Model *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {MODELS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[styles.chip, model === m.value && styles.chipActive]}
                  onPress={() => setModel(m.value)}
                >
                  <Text style={[styles.chipText, model === m.value && styles.chipTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Effective From *</Text>
            <TouchableOpacity style={styles.dateTouchable} onPress={() => setShowDate(true)} activeOpacity={0.7}>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>
                {new Date(effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </TouchableOpacity>
            {showDate && (
              <DateTimePicker
                value={new Date(effectiveFrom)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  setShowDate(Platform.OS === 'ios');
                  if (d) setEffectiveFrom(d.toISOString().split('T')[0]);
                }}
              />
            )}

            {/* Model-specific fields */}
            {model === 'PER_KL' && (
              <>
                <Text style={[styles.label, { marginTop: spacing.base }]}>Rate per KL (₹) *</Text>
                <TextInput
                  style={styles.input}
                  value={ratePerKL}
                  onChangeText={(v) => setRatePerKL(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 25"
                  placeholderTextColor={colors.textTertiary}
                />
              </>
            )}

            {model === 'PER_LITRE' && (
              <>
                <Text style={[styles.label, { marginTop: spacing.base }]}>Rate per Litre (₹) *</Text>
                <TextInput
                  style={styles.input}
                  value={ratePerLitre}
                  onChangeText={(v) => setRatePerLitre(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 0.025"
                  placeholderTextColor={colors.textTertiary}
                />
              </>
            )}

            {model === 'FIXED_CHARGE' && (
              <>
                <Text style={[styles.label, { marginTop: spacing.base }]}>Fixed Amount (₹) *</Text>
                <TextInput
                  style={styles.input}
                  value={fixedAmount}
                  onChangeText={(v) => setFixedAmount(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 300"
                  placeholderTextColor={colors.textTertiary}
                />
              </>
            )}

            {model === 'FIXED_PLUS_USAGE' && (
              <>
                <View style={styles.row2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Fixed Amount (₹) *</Text>
                    <TextInput
                      style={styles.input}
                      value={fixedAmount}
                      onChangeText={(v) => setFixedAmount(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 150"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Rate/KL beyond min (₹) *</Text>
                    <TextInput
                      style={styles.input}
                      value={ratePerKL}
                      onChangeText={(v) => setRatePerKL(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 20"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                </View>
                <Text style={[styles.label, { marginTop: spacing.base }]}>Minimum KL Included</Text>
                <TextInput
                  style={styles.input}
                  value={minimumKL}
                  onChangeText={(v) => setMinimumKL(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 5"
                  placeholderTextColor={colors.textTertiary}
                />
              </>
            )}

            {model === 'SLAB_BASED' && (
              <View style={{ marginTop: spacing.base }}>
                <Text style={styles.label}>Slabs *</Text>
                <Text style={styles.hint}>Each slab covers consumption up to its limit; anything beyond the last slab uses its rate.</Text>
                {slabs.map((slab, i) => (
                  <View key={i} style={styles.slabRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={slab.upTo}
                      onChangeText={(v) => {
                        const next = [...slabs];
                        next[i] = { ...next[i], upTo: v.replace(/[^0-9.]/g, '') };
                        setSlabs(next);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="Up to (KL)"
                      placeholderTextColor={colors.textTertiary}
                    />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={slab.rate}
                      onChangeText={(v) => {
                        const next = [...slabs];
                        next[i] = { ...next[i], rate: v.replace(/[^0-9.]/g, '') };
                        setSlabs(next);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="Rate (₹)"
                      placeholderTextColor={colors.textTertiary}
                    />
                    {slabs.length > 1 && (
                      <TouchableOpacity onPress={() => setSlabs(slabs.filter((_, j) => j !== i))} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.addSlabBtn}
                  onPress={() => setSlabs([...slabs, { upTo: '', rate: '' }])}
                >
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.addSlabText}>Add Slab</Text>
                </TouchableOpacity>
              </View>
            )}

            <Button
              label={mutation.isPending ? 'Saving…' : 'Create Configuration'}
              onPress={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────

export default function WaterConfigsScreen() {
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['water-configs'],
    queryFn: waterApi.listConfigs,
  });

  const configs = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Water Billing Model"
        showBack
        rightAction={
          <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      {isLoading ? (
        <LoadingState message="Loading configurations…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load configurations" description="Pull down to retry." />
      ) : (
        <FlatList
          data={configs}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <StatusBadge label={modelLabel(item.billingModel)} variant="info" size="sm" />
                </View>
                <Text style={styles.rowRate}>{rateSummary(item)}</Text>
                <Text style={styles.rowMeta}>
                  Effective from {new Date(item.effectiveFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {item.effectiveTo ? ` to ${new Date(item.effectiveTo).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="water-outline"
              title="No configurations yet"
              description="Set a billing model and rate — Per-KL, slab-based, fixed + usage, etc."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {showCreate && <CreateConfigModal onClose={() => setShowCreate(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    gap: 4,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600', flex: 1, marginRight: spacing.sm },
  rowRate: { ...typography.bodyMedium, color: colors.primary, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary },

  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text, fontWeight: '700' },
  modalBody: { padding: spacing.base },

  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  row2: { flexDirection: 'row', gap: spacing.md },

  chipScroll: { marginTop: 6, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    marginRight: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },

  dateTouchable: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
  },
  dateText: { ...typography.bodyMedium, color: colors.text },

  slabRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.sm },
  addSlabBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  addSlabText: { ...typography.labelMedium, color: colors.primary, fontWeight: '600' },
});
