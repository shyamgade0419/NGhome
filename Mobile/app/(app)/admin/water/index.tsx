import React, { useState, useEffect, useCallback } from 'react';
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
  RefreshControl,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { waterApi, AllocateCostsPayload } from '@/api/endpoints/water.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { BillingPeriod, billingPeriodName } from '@/types/billing.types';
import { Flat } from '@/types/society.types';

/* ── Cost input row ──────────────────────────────────────────────── */
function CostRow({
  icon,
  label,
  hint,
  value,
  onChangeText,
  suffix,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  suffix?: string;
}) {
  return (
    <View style={costStyles.row}>
      <View style={costStyles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={costStyles.textCol}>
        <Text style={costStyles.label}>{label}</Text>
        {hint ? <Text style={costStyles.hint}>{hint}</Text> : null}
      </View>
      <View style={costStyles.inputWrap}>
        <TextInput
          style={costStyles.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textTertiary}
        />
        {suffix ? <Text style={costStyles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const costStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textCol: { flex: 1 },
  label: { ...typography.labelLarge, color: colors.text },
  hint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: {
    width: 90,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.bodyMedium,
    color: colors.text,
    textAlign: 'right',
  },
  suffix: { ...typography.bodySmall, color: colors.textSecondary },
});

/* ── Flat reading row ────────────────────────────────────────────── */
interface FlatEntry {
  flatId: string;
  flatCode: string;
  opening: string;
  closing: string;
  /** True when opening was carried forward from a previous month's closing. */
  carriedForward: boolean;
}

/**
 * Only the closing reading is entered once a flat has history: the opening is
 * last month's closing, carried forward automatically. Typing it again each
 * month is busywork and a chance to introduce a gap between periods, which
 * would silently mis-bill consumption.
 *
 * The very first time a flat is read there is nothing to carry forward, so the
 * opening is editable and clearly labelled as the starting reading.
 */
function FlatReadingRow({
  entry,
  onChange,
}: {
  entry: FlatEntry;
  onChange: (field: 'opening' | 'closing', val: string) => void;
}) {
  const units = parseFloat(entry.closing || '0') - parseFloat(entry.opening || '0');
  const hasClosing = entry.closing !== '';
  const invalid = hasClosing && units < 0;

  return (
    <View style={flatStyles.row}>
      <View style={flatStyles.flatInfo}>
        <Text style={flatStyles.flatCode}>{entry.flatCode}</Text>
        {hasClosing && !invalid && <Text style={flatStyles.units}>{units} KL</Text>}
        {invalid && (
          <Text style={[flatStyles.units, { color: colors.error }]}>Below previous</Text>
        )}
      </View>

      <View style={flatStyles.inputs}>
        <View style={flatStyles.inputGroup}>
          <Text style={flatStyles.inputLabel}>
            {entry.carriedForward ? 'Previous' : 'Opening'}
          </Text>
          {entry.carriedForward ? (
            /* Read-only: this is last month's closing, not something to retype. */
            <View style={flatStyles.readOnly}>
              <Text style={flatStyles.readOnlyText}>{entry.opening}</Text>
            </View>
          ) : (
            <TextInput
              style={flatStyles.input}
              value={entry.opening}
              onChangeText={(v) => onChange('opening', v)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
          )}
        </View>

        <Ionicons name="arrow-forward" size={14} color={colors.textTertiary} style={{ marginTop: 18 }} />

        <View style={flatStyles.inputGroup}>
          <Text style={flatStyles.inputLabel}>Current</Text>
          <TextInput
            style={[
              flatStyles.input,
              { borderColor: invalid ? colors.error : entry.closing ? colors.primary : colors.border },
            ]}
            value={entry.closing}
            onChangeText={(v) => onChange('closing', v)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      {entry.carriedForward && (
        <Text style={flatStyles.carryNote}>
          Previous reading carried forward from last month
        </Text>
      )}
    </View>
  );
}

const flatStyles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  flatInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flatCode: { ...typography.headingSmall, color: colors.text },
  units: { ...typography.labelLarge, color: colors.secondary },
  inputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  inputGroup: { flex: 1, gap: 4 },
  inputLabel: { ...typography.labelSmall, color: colors.textSecondary },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.bodyMedium,
    color: colors.text,
    textAlign: 'center',
  },
  readOnly: {
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSecondary ?? colors.background,
    alignItems: 'center',
  },
  readOnlyText: { ...typography.bodyMedium, color: colors.textSecondary, textAlign: 'center' },
  carryNote: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 10, marginTop: 2 },
});

/* ── Main Screen ─────────────────────────────────────────────────── */
export default function WaterReadingsScreen() {
  const qc = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  // Society-wide costs
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [costs, setCosts] = useState({
    readingDate: new Date().toISOString().split('T')[0],
    municipalWaterBill: '',
    tankerCost: '',
    commonElectricityBill: '',
    electricityWaterPercent: '50',
  });

  // Per-flat readings
  const [flatEntries, setFlatEntries] = useState<FlatEntry[]>([]);

  const { data: periodsData, isLoading: periodsLoading } = useQuery({
    queryKey: ['billing-periods-water'],
    queryFn: () => billingApi.getBillingPeriods({ limit: 12 }),
  });

  const { data: flatsData, isLoading: flatsLoading, refetch, isRefetching } = useQuery({
    queryKey: ['flats-all'],
    queryFn: () => societiesApi.getFlats({ limit: 200 }),
  });

  // Auto-select first open period
  useEffect(() => {
    if (!selectedPeriodId && periodsData?.data?.length) {
      const open = periodsData.data.find((p) => p.status !== 'CLOSED');
      setSelectedPeriodId(open?.id ?? periodsData.data[0].id);
    }
  }, [periodsData, selectedPeriodId]);

  // Whole reading history, newest first — used to carry each flat's last
  // closing reading forward as this month's opening.
  const { data: history } = useQuery({
    queryKey: ['water-readings-history'],
    queryFn: () => waterApi.getReadings(),
  });

  // Build flat entries once both flats and reading history are available.
  useEffect(() => {
    if (!flatsData?.data?.length) return;

    // getReadings returns newest first, so the first hit per flat is the latest.
    const lastClosingByFlat = new Map<string, string>();
    for (const r of history ?? []) {
      if (!lastClosingByFlat.has(r.flatId)) {
        lastClosingByFlat.set(r.flatId, String(r.closingReading ?? ''));
      }
    }

    setFlatEntries(
      flatsData.data.map((f: Flat) => {
        const carried = lastClosingByFlat.get(f.id);
        return {
          flatId: f.id,
          flatCode: f.flatCode ?? f.unitNumber ?? f.id,
          opening: carried ?? '',
          closing: '',
          carriedForward: carried !== undefined,
        };
      }),
    );
  }, [flatsData, history]);

  const allocateMutation = useMutation({
    mutationFn: (payload: AllocateCostsPayload) =>
      waterApi.allocatePeriodCosts(selectedPeriodId!, payload),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['water-period-summary', selectedPeriodId] });
      // Refresh history so these closing readings become next month's openings.
      qc.invalidateQueries({ queryKey: ['water-readings-history'] });
      const rate = result?.ratePerUnit?.toFixed(2) ?? '—';
      const total = result?.flatReadings?.length ?? 0;
      Alert.alert(
        'Water Readings Saved ✓',
        `Rate: ₹${rate}/KL across ${total} flats.\nBills will reflect the new water charges.`,
        [{ text: 'OK' }],
      );
    },
    onError: (err: any) =>
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to save readings. Check all values and try again.'),
  });

  const handleSave = () => {
    if (!selectedPeriodId) {
      Alert.alert('Select Period', 'Please select a billing period first.');
      return;
    }
    // A flat counts as entered when it has a current reading. The opening is
    // carried forward automatically, so it is no longer a signal of intent.
    const filledReadings = flatEntries.filter((e) => e.closing !== '');
    if (filledReadings.length === 0) {
      Alert.alert('No Readings', 'Enter at least one current reading before saving.');
      return;
    }

    const missingOpening = filledReadings.find((e) => e.opening === '');
    if (missingOpening) {
      Alert.alert(
        'Opening Reading Needed',
        `Flat ${missingOpening.flatCode} has no previous reading on record. Enter its opening reading — this is a one-time step.`,
      );
      return;
    }

    const invalid = filledReadings.find(
      (e) =>
        isNaN(parseFloat(e.opening)) ||
        isNaN(parseFloat(e.closing)) ||
        parseFloat(e.closing) < parseFloat(e.opening),
    );
    if (invalid) {
      Alert.alert(
        'Invalid Reading',
        `Flat ${invalid.flatCode}: the current reading cannot be lower than the previous one (${invalid.opening}).`,
      );
      return;
    }

    Alert.alert(
      'Save Water Readings',
      `Save readings for ${filledReadings.length} flat(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: () =>
            allocateMutation.mutate({
              readingDate: costs.readingDate,
              municipalWaterBill: parseFloat(costs.municipalWaterBill || '0'),
              tankerCost: parseFloat(costs.tankerCost || '0'),
              commonElectricityBill: parseFloat(costs.commonElectricityBill || '0'),
              electricityWaterPercent: parseFloat(costs.electricityWaterPercent || '50'),
              readings: filledReadings.map((e) => ({
                flatId: e.flatId,
                openingReading: parseFloat(e.opening),
                closingReading: parseFloat(e.closing),
              })),
            }),
        },
      ],
    );
  };

  const periods: BillingPeriod[] = periodsData?.data ?? [];
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const totalCost =
    parseFloat(costs.municipalWaterBill || '0') +
    parseFloat(costs.tankerCost || '0') +
    parseFloat(costs.commonElectricityBill || '0') * (parseFloat(costs.electricityWaterPercent || '50') / 100);

  if (periodsLoading || flatsLoading) return <LoadingState fullscreen message="Loading..." />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Water Readings"
        rightAction={
          <Button
            label="Save"
            onPress={handleSave}
            loading={allocateMutation.isPending}
            size="sm"
          />
        }
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Period Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Period</Text>
            <TouchableOpacity
              style={styles.periodBtn}
              onPress={() => setShowPeriodPicker((v) => !v)}
            >
              <Text style={styles.periodBtnText}>
                {selectedPeriod ? billingPeriodName(selectedPeriod) : 'Select period…'}
              </Text>
              <Ionicons
                name={showPeriodPicker ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {showPeriodPicker && (
              <View style={styles.picker}>
                {periods.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.pickerItem, p.id === selectedPeriodId && styles.pickerItemActive]}
                    onPress={() => {
                      setSelectedPeriodId(p.id);
                      setShowPeriodPicker(false);
                    }}
                  >
                    <Text style={[styles.pickerText, p.id === selectedPeriodId && styles.pickerTextActive]}>
                      {billingPeriodName(p)}
                    </Text>
                    <Text style={styles.pickerStatus}>{p.status}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Society-wide Costs */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Society Costs This Month</Text>
            <Text style={styles.sectionHint}>Enter what the society paid for water this billing period.</Text>

            <CostRow
              icon="water-outline"
              label="Municipal Water Bill"
              hint="Amount on your water board invoice"
              value={costs.municipalWaterBill}
              onChangeText={(v) => setCosts((c) => ({ ...c, municipalWaterBill: v }))}
              suffix="₹"
            />
            <CostRow
              icon="car-outline"
              label="Tanker Cost"
              hint="If any tanker water was purchased"
              value={costs.tankerCost}
              onChangeText={(v) => setCosts((c) => ({ ...c, tankerCost: v }))}
              suffix="₹"
            />
            <CostRow
              icon="flash-outline"
              label="Electricity for Water"
              hint="Motor / pump electricity bill"
              value={costs.commonElectricityBill}
              onChangeText={(v) => setCosts((c) => ({ ...c, commonElectricityBill: v }))}
              suffix="₹"
            />
            <CostRow
              icon="pie-chart-outline"
              label="Electricity → Water %"
              hint="What % of electricity bill is water-related"
              value={costs.electricityWaterPercent}
              onChangeText={(v) => setCosts((c) => ({ ...c, electricityWaterPercent: v }))}
              suffix="%"
            />

            {totalCost > 0 && (
              <View style={styles.totalCostBadge}>
                <Ionicons name="calculator-outline" size={14} color={colors.primary} />
                <Text style={styles.totalCostText}>
                  Total water cost to distribute: ₹{totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </Text>
              </View>
            )}
          </View>

          {/* Reading Date */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reading Date</Text>
            <TouchableOpacity
              style={styles.dateTouchable}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.dateText}>
                {new Date(costs.readingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={new Date(costs.readingDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                onChange={(_: DateTimePickerEvent, date?: Date) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  if (date) setCosts((c) => ({ ...c, readingDate: date.toISOString().split('T')[0] }));
                }}
              />
            )}
          </View>

          {/* Per-flat Readings */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Flat Readings</Text>
              <Text style={styles.sectionHint2}>{flatEntries.length} flats</Text>
            </View>
            <Text style={styles.sectionHint}>
              Enter only the current meter reading. The previous reading is carried forward
              from last month automatically. Leave a flat blank to skip it.
            </Text>

            {flatEntries.map((entry, i) => (
              <FlatReadingRow
                key={entry.flatId}
                entry={entry}
                onChange={(field, val) => {
                  setFlatEntries((prev) => {
                    const next = [...prev];
                    next[i] = { ...next[i], [field]: val };
                    return next;
                  });
                }}
              />
            ))}
          </View>

          {/* Save button at bottom */}
          <Button
            label={allocateMutation.isPending ? 'Saving…' : 'Save Readings'}
            onPress={handleSave}
            loading={allocateMutation.isPending}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.md }}
          />
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { ...typography.headingSmall, color: colors.text, marginBottom: spacing.xs },
  sectionHint: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  sectionHint2: { ...typography.bodySmall, color: colors.textSecondary },

  periodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryLight,
  },
  periodBtnText: { ...typography.labelLarge, color: colors.primary },

  picker: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  pickerItemActive: { backgroundColor: colors.primaryLight },
  pickerText: { ...typography.bodyMedium, color: colors.text },
  pickerTextActive: { color: colors.primary, fontWeight: '600' },
  pickerStatus: { ...typography.bodySmall, color: colors.textTertiary },

  totalCostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  totalCostText: { ...typography.labelLarge, color: colors.primary },

  dateTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  dateText: {
    ...typography.bodyMedium,
    color: colors.text,
    flex: 1,
  },
});
