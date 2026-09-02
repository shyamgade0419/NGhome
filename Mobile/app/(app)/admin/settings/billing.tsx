/**
 * Admin — Billing Configuration
 *
 * The SocietyConfiguration billing fields: cycle, due day, grace period, late
 * fees and invoice prefix. These are distinct from Billing Rules — rules decide
 * how a flat's charge is calculated, this decides when it is due and what
 * happens when it is late.
 *
 * Only the billing fields are sent on save. Sending the whole config object
 * would let this screen clobber the visibility toggles owned by Notification
 * Settings and the UPI fields owned by Society Settings — the exact bug that
 * had auto-approve silently reverting itself.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

const CYCLES = ['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM'] as const;
const LATE_FEE_TYPES = [
  { value: 'NONE', label: 'None' },
  { value: 'FIXED', label: 'Fixed ₹' },
  { value: 'PERCENTAGE', label: 'Percentage %' },
];

interface BillingConfig {
  billingCycle: string;
  billingDueDay: string;
  gracePeriodDays: string;
  lateFeeType: string;
  lateFeeValue: string;
  lateFeeMaxAmount: string;
  invoicePrefix: string;
  currency: string;
  financialYearStartMonth: string;
  /** Stored in additionalConfig, not a DB column — same pattern as upiId. */
  waterBillingEnabled: boolean;
}

const DEFAULTS: BillingConfig = {
  billingCycle: 'MONTHLY',
  billingDueDay: '10',
  gracePeriodDays: '0',
  lateFeeType: 'NONE',
  lateFeeValue: '0',
  lateFeeMaxAmount: '',
  invoicePrefix: '',
  currency: 'INR',
  financialYearStartMonth: '4',
  waterBillingEnabled: true,
};

function Field({
  label, hint, value, onChangeText, keyboardType, placeholder, suffix,
}: {
  label: string; hint?: string; value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  placeholder?: string; suffix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType ?? 'default'}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export default function BillingConfigScreen() {
  const qc = useQueryClient();
  const [form, setForm] = useState<BillingConfig>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['society-config-mobile'],
    queryFn: () => apiClient.get('/societies/my/config').then((r: any) => r.data?.data ?? r.data),
  });

  useEffect(() => {
    if (data) {
      setForm({
        billingCycle: data.billingCycle ?? 'MONTHLY',
        billingDueDay: String(data.billingDueDay ?? 10),
        gracePeriodDays: String(data.gracePeriodDays ?? 0),
        lateFeeType: data.lateFeeType ?? 'NONE',
        lateFeeValue: String(data.lateFeeValue ?? 0),
        lateFeeMaxAmount: data.lateFeeMaxAmount != null ? String(data.lateFeeMaxAmount) : '',
        invoicePrefix: data.invoicePrefix ?? '',
        currency: data.currency ?? 'INR',
        financialYearStartMonth: String(data.financialYearStartMonth ?? 4),
        // Defaults to true (via ?? true) so societies that never touched this
        // setting keep seeing water billing exactly as before.
        waterBillingEnabled: data.additionalConfig?.waterBillingEnabled ?? true,
      });
      setDirty(false);
    }
  }, [data]);

  const mutation = useMutation({
    // Send only billing fields — never the whole config object.
    mutationFn: () =>
      apiClient.patch('/societies/my/config', {
        billingCycle: form.billingCycle,
        billingDueDay: parseInt(form.billingDueDay || '10', 10),
        gracePeriodDays: parseInt(form.gracePeriodDays || '0', 10),
        lateFeeType: form.lateFeeType,
        lateFeeValue: parseFloat(form.lateFeeValue || '0'),
        ...(form.lateFeeMaxAmount.trim()
          ? { lateFeeMaxAmount: parseFloat(form.lateFeeMaxAmount) }
          : {}),
        ...(form.invoicePrefix.trim() ? { invoicePrefix: form.invoicePrefix.trim() } : {}),
        currency: form.currency || 'INR',
        financialYearStartMonth: parseInt(form.financialYearStartMonth || '4', 10),
        waterBillingEnabled: form.waterBillingEnabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-config-mobile'] });
      setDirty(false);
      Alert.alert('Saved', 'Billing configuration updated.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save. Please try again.'),
  });

  const set = (key: keyof BillingConfig) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setDirty(true);
  };

  const dueDayValid = (() => {
    const n = parseInt(form.billingDueDay, 10);
    return !isNaN(n) && n >= 1 && n <= 28;
  })();

  if (isLoading) return <LoadingState fullscreen message="Loading billing settings…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Billing Configuration" showBack />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Cycle */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Cycle</Text>
            <View style={styles.chipRow}>
              {CYCLES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, form.billingCycle === c && styles.chipActive]}
                  onPress={() => set('billingCycle')(c)}
                >
                  <Text style={[styles.chipText, form.billingCycle === c && styles.chipTextActive]}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Field
              label="Due Day of Month"
              hint="Day the bill falls due. Keep it at 28 or below so every month behaves the same."
              value={form.billingDueDay}
              onChangeText={(v) => set('billingDueDay')(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="10"
            />
            {!dueDayValid && form.billingDueDay !== '' && (
              <Text style={styles.error}>Enter a day between 1 and 28.</Text>
            )}

            <Field
              label="Grace Period"
              hint="Days after the due date before a late fee applies."
              value={form.gracePeriodDays}
              onChangeText={(v) => set('gracePeriodDays')(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              suffix="days"
            />
          </View>

          {/* Water billing */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Water Usage Billing</Text>
                <Text style={styles.hint}>
                  Turn off if this society doesn&apos;t meter or bill water separately.
                  Hides the Water tab and water charges from new bills; existing bills
                  are unaffected.
                </Text>
              </View>
              <Switch
                value={form.waterBillingEnabled}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, waterBillingEnabled: v }));
                  setDirty(true);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>
          </View>

          {/* Late fees */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Late Fees</Text>
            <View style={styles.chipRow}>
              {LATE_FEE_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.chip, form.lateFeeType === t.value && styles.chipActive]}
                  onPress={() => set('lateFeeType')(t.value)}
                >
                  <Text style={[styles.chipText, form.lateFeeType === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {form.lateFeeType !== 'NONE' && (
              <>
                <Field
                  label={form.lateFeeType === 'PERCENTAGE' ? 'Late Fee Percentage' : 'Late Fee Amount'}
                  value={form.lateFeeValue}
                  onChangeText={(v) => set('lateFeeValue')(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  suffix={form.lateFeeType === 'PERCENTAGE' ? '%' : '₹'}
                />
                <Field
                  label="Maximum Late Fee"
                  hint="Optional cap so the fee cannot grow without limit."
                  value={form.lateFeeMaxAmount}
                  onChangeText={(v) => set('lateFeeMaxAmount')(v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="No cap"
                  suffix="₹"
                />
              </>
            )}
          </View>

          {/* Invoicing */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Invoicing</Text>
            <Field
              label="Invoice Prefix"
              hint="Prepended to generated invoice numbers, e.g. NGH/2026/001."
              value={form.invoicePrefix}
              onChangeText={set('invoicePrefix')}
              placeholder="NGH"
            />
            <Field
              label="Financial Year Starts"
              hint="Month number. India's financial year starts in April, so 4."
              value={form.financialYearStartMonth}
              onChangeText={(v) => set('financialYearStartMonth')(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="4"
            />
          </View>

          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={15} color={colors.info} />
            <Text style={styles.noticeText}>
              These apply to bills generated from now on. Bills already issued keep the terms they
              were created with.
            </Text>
          </View>

          <Button
            label={mutation.isPending ? 'Saving…' : 'Save Billing Settings'}
            onPress={() => {
              if (!dueDayValid) {
                Alert.alert('Invalid Due Day', 'Enter a day between 1 and 28.');
                return;
              }
              mutation.mutate();
            }}
            loading={mutation.isPending}
            disabled={!dirty}
            fullWidth
            size="lg"
          />
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md },

  section: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.base,
  },
  sectionTitle: { ...typography.headingSmall, color: colors.text, marginBottom: spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.primary },

  field: { marginTop: spacing.md },
  label: { ...typography.labelLarge, color: colors.text },
  hint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2, marginBottom: 6, lineHeight: 17 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  suffix: { ...typography.bodyMedium, color: colors.textSecondary },
  error: { ...typography.bodySmall, color: colors.error, marginTop: 4 },

  notice: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    backgroundColor: colors.infoLight, borderRadius: radius.md, padding: spacing.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.info, flex: 1, lineHeight: 17 },
});
