import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { DiscountType, FlatDiscount, STATUS_LABEL, describeDiscount, monthEnd, monthStart, parseMonth } from '@/utils/flatDiscounts';
import { parseMoney } from '@/utils/openingBalances';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// ── Add one ───────────────────────────────────────────────────────────────────

function AddSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: flats } = useQuery({
    queryKey: ['flats-for-discount'],
    queryFn: async () => (await societiesApi.getFlats({ limit: 500 })).data ?? [],
  });
  const [search, setSearch] = useState('');
  const [flat, setFlat] = useState<{ id: string; flatCode: string } | null>(null);
  const [type, setType] = useState<DiscountType>('FIXED');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState(thisMonth());
  const [until, setUntil] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (flats ?? []).filter((f: any) => !q || f.flatCode.toLowerCase().includes(q)).slice(0, 6);
  }, [flats, search]);

  const amount = parseMoney(value);
  const fromMonth = parseMonth(from);
  const untilMonth = until.trim() ? parseMonth(until) : null;
  const problem =
    !flat ? 'Choose a flat.'
    : amount === null || Number.isNaN(amount) || amount <= 0 ? 'Enter the discount.'
    : type === 'PERCENT' && amount > 100 ? 'A percentage cannot be more than 100.'
    : reason.trim().length < 3 ? 'Give a short reason.'
    : !fromMonth ? 'Enter the first month as 2026-04.'
    : until.trim() && !untilMonth ? 'Enter the last month as 2027-03, or leave it empty.'
    : untilMonth && untilMonth < (fromMonth as string) ? 'It cannot end before it starts.'
    : null;

  const create = useMutation({
    mutationFn: () =>
      billingApi.createFlatDiscount({
        flatId: flat!.id, type, value: amount as number, reason: reason.trim(),
        effectiveFrom: monthStart(fromMonth as string), effectiveTo: untilMonth ? monthEnd(untilMonth) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flat-discounts'] });
      onClose();
      setTimeout(() => Alert.alert('Added', 'The discount is taken off bills generated from now on.'), 400);
    },
    onError: (e: any) => Alert.alert('Could not add', e?.response?.data?.message ?? 'Please try again.'),
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={sheet.overlay}>
          <View style={sheet.card}>
            <View style={sheet.header}>
              <Text style={sheet.title}>Add a flat discount</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={sheet.label}>Flat</Text>
              {flat ? (
                <TouchableOpacity style={sheet.chosen} onPress={() => setFlat(null)} accessibilityLabel="Change flat">
                  <Text style={sheet.chosenText}>{flat.flatCode}</Text>
                  <Text style={sheet.change}>Change</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TextInput style={sheet.input} value={search} onChangeText={setSearch} placeholder="Find a flat, e.g. A-101" placeholderTextColor={colors.textTertiary} autoCapitalize="none" accessibilityLabel="Find a flat" />
                  {matches.map((f: any) => (
                    <TouchableOpacity key={f.id} style={sheet.option} onPress={() => setFlat({ id: f.id, flatCode: f.flatCode })} accessibilityLabel={`Choose ${f.flatCode}`}>
                      <Text style={sheet.optionText}>{f.flatCode}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              <Text style={sheet.label}>Type</Text>
              <View style={sheet.row}>
                {(['FIXED', 'PERCENT'] as DiscountType[]).map((t) => (
                  <TouchableOpacity key={t} style={[sheet.chip, type === t && sheet.chipOn]} onPress={() => setType(t)} accessibilityLabel={t === 'FIXED' ? 'Fixed amount' : 'Percentage'}>
                    <Text style={[sheet.chipText, type === t && sheet.chipTextOn]}>{t === 'FIXED' ? 'Fixed amount (₹)' : 'Percentage (%)'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={sheet.label}>{type === 'PERCENT' ? 'Percentage off' : 'Amount off each bill (₹)'}</Text>
              <TextInput style={sheet.input} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={type === 'PERCENT' ? '10' : '500'} placeholderTextColor={colors.textTertiary} accessibilityLabel="Discount value" />

              <Text style={sheet.label}>Reason (kept on the bill)</Text>
              <TextInput style={sheet.input} value={reason} onChangeText={setReason} maxLength={200} placeholder="Senior citizen concession" placeholderTextColor={colors.textTertiary} accessibilityLabel="Reason" />

              <View style={sheet.row}>
                <View style={{ flex: 1 }}>
                  <Text style={sheet.label}>From month</Text>
                  <TextInput style={sheet.input} value={from} onChangeText={setFrom} placeholder="2026-04" placeholderTextColor={colors.textTertiary} autoCapitalize="none" accessibilityLabel="From month" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sheet.label}>Until (optional)</Text>
                  <TextInput style={sheet.input} value={until} onChangeText={setUntil} placeholder="2027-03" placeholderTextColor={colors.textTertiary} autoCapitalize="none" accessibilityLabel="Until month" />
                </View>
              </View>

              <Text style={sheet.hint}>
                Taken off every bill generated for these months, and kept if bills are regenerated. A percentage is of the flat&apos;s maintenance
                and charges, not water.
              </Text>
              {problem ? <Text style={sheet.bad}>{problem}</Text> : null}
              <View style={{ marginTop: spacing.md }}>
                <Button label="Add discount" onPress={() => create.mutate()} loading={create.isPending} disabled={!!problem} fullWidth />
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function FlatDiscountsScreen() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['flat-discounts'],
    queryFn: billingApi.listFlatDiscounts,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['flat-discounts'] });
  const toggle = useMutation({
    mutationFn: (d: FlatDiscount) => billingApi.updateFlatDiscount(d.id, { isActive: !d.isActive }),
    onSuccess: refresh,
    onError: (e: any) => Alert.alert('Could not change', e?.response?.data?.message ?? 'Please try again.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => billingApi.deleteFlatDiscount(id),
    onSuccess: refresh,
    onError: (e: any) => Alert.alert('Could not remove', e?.response?.data?.message ?? 'Please try again.'),
  });

  const addButton = (
    <TouchableOpacity onPress={() => setAdding(true)} hitSlop={8} style={{ padding: 4 }} accessibilityLabel="Add a flat discount">
      <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Flat Discounts" subtitle="Standing concessions" showBack rightAction={addButton} />
      {isLoading ? (
        <LoadingState message="Loading discounts…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load discounts" description="Pull down to retry." />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={15} color={colors.info} />
              <Text style={styles.noticeText}>
                A discount for one flat that applies month after month. It is taken off every bill generated while it is in force and shows
                as a Discount line. For a one-off adjustment on a single bill, use the Maintenance Sheet.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.top}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.flat}>{item.flatCode}{item.residentName ? ` · ${item.residentName}` : ''}</Text>
                  <Text style={styles.value}>{describeDiscount(item.type, item.value)}</Text>
                  <Text style={styles.reason}>{item.reason}</Text>
                  <Text style={styles.dates}>From {day(item.effectiveFrom)}{item.effectiveTo ? ` to ${day(item.effectiveTo)}` : ', no end'}</Text>
                </View>
                <StatusBadge label={STATUS_LABEL[item.status].text} variant={STATUS_LABEL[item.status].variant} size="sm" />
              </View>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.action} onPress={() => toggle.mutate(item)} accessibilityLabel={item.isActive ? `Switch off the discount for ${item.flatCode}` : `Switch on the discount for ${item.flatCode}`}>
                  <Text style={styles.actionText}>{item.isActive ? 'Switch off' : 'Switch on'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.action}
                  accessibilityLabel={`Remove the discount for ${item.flatCode}`}
                  onPress={() =>
                    Alert.alert('Remove discount', `Remove the ${describeDiscount(item.type, item.value)} discount for ${item.flatCode}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(item.id) },
                    ])
                  }
                >
                  <Text style={[styles.actionText, { color: colors.error }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="pricetag-outline" title="No flat discounts" description="Tap + to take a fixed amount or a percentage off a flat's bills." />}
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  );
}

const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl, maxHeight: '90%', paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { ...typography.headingSmall, color: colors.text },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 4 },
  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, ...typography.bodyMedium, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextOn: { color: '#fff' },
  option: { paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  optionText: { ...typography.bodyMedium, color: colors.text },
  chosen: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  chosenText: { ...typography.labelLarge, color: colors.text },
  change: { ...typography.labelMedium, color: colors.primary },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginTop: spacing.md },
  bad: { ...typography.bodySmall, color: colors.error, marginTop: spacing.sm },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoLight, marginBottom: spacing.md },
  noticeText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  top: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  flat: { ...typography.labelLarge, color: colors.text },
  value: { ...typography.headingSmall, color: colors.primary, marginTop: 2 },
  reason: { ...typography.bodyMedium, color: colors.text },
  dates: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: spacing.sm },
  action: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  actionText: { ...typography.labelMedium, color: colors.primary, fontWeight: '600' },
});
