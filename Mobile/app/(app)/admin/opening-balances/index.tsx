import React, { useMemo, useState } from 'react';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr, toNum } from '@/utils/format';
import { OpeningRow, filterOpeningRows, isoDay, parseMoney, saveMessage } from '@/utils/openingBalances';

// ── Edit one flat ─────────────────────────────────────────────────────────────

function EditSheet({
  row,
  asOfDate,
  onClose,
}: {
  row: OpeningRow;
  asOfDate: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(row.amount === null ? '' : String(toNum(row.amount)));
  const [note, setNote] = useState(row.note ?? '');
  const parsed = parseMoney(amount);
  const invalid = Number.isNaN(parsed);

  const mutation = useMutation({
    mutationFn: (value: number) =>
      billingApi.saveOpeningBalances({ asOfDate, rows: [{ flatCode: row.flatCode, amount: value, note: note.trim() }] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
      // Close the sheet first and raise the alert once its slide-out has finished — both at the same
      // instant can wedge Android's native modal layer.
      onClose();
      setTimeout(() => Alert.alert(res.summary.rejected > 0 ? 'Not saved' : 'Saved', saveMessage(res)), 400);
    },
    onError: (e: any) => Alert.alert('Could not save', e?.response?.data?.message ?? 'Please try again.'),
  });

  const hadBalance = row.amount !== null;
  const canSave = !row.locked && !invalid && parsed !== null && parsed > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={sheet.overlay}>
          <View style={sheet.card}>
            <View style={sheet.header}>
              <View style={{ flex: 1 }}>
                <Text style={sheet.title}>{row.flatCode}</Text>
                {row.residentName ? <Text style={sheet.sub}>{row.residentName}</Text> : null}
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {row.locked ? (
              <View style={sheet.locked}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.warning} />
                <Text style={sheet.lockedText}>
                  {inr(row.amount)} owed, {inr(row.paidAmount)} paid. {row.locked}
                </Text>
              </View>
            ) : (
              <>
                <Text style={sheet.label}>What this flat owed (₹)</Text>
                <TextInput
                  style={[sheet.input, invalid && sheet.inputBad]}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Opening balance"
                />
                {invalid ? <Text style={sheet.bad}>That is not an amount.</Text> : null}

                <Text style={sheet.label}>Note (optional)</Text>
                <TextInput
                  style={sheet.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Paper ledger, to March"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={200}
                  accessibilityLabel="Note"
                />

                <View style={sheet.actions}>
                  {hadBalance ? (
                    <Button
                      label="Remove"
                      variant="outline"
                      onPress={() =>
                        Alert.alert('Remove balance', `Remove the opening balance of ${row.flatCode}? Nothing has been paid against it.`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => mutation.mutate(0) },
                        ])
                      }
                      disabled={mutation.isPending}
                    />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Save"
                      onPress={() => mutation.mutate(parsed as number)}
                      loading={mutation.isPending}
                      disabled={!canSave}
                      fullWidth
                    />
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function OpeningBalancesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['opening-balances'],
    queryFn: billingApi.getOpeningBalances,
  });

  const [asOf, setAsOf] = useState<string>('');
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [editing, setEditing] = useState<OpeningRow | null>(null);

  const today = isoDay(new Date());
  const asOfDate = asOf || (data?.asOfDate ? data.asOfDate.slice(0, 10) : today);
  const rows = useMemo(() => filterOpeningRows(data?.rows ?? [], search, onlyWithBalance), [data, search, onlyWithBalance]);

  const header = data ? (
    <View style={styles.header}>
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={15} color={colors.info} />
        <Text style={styles.noticeText}>
          Enter what each flat owed on your paper or Excel records. It becomes the flat's oldest due: a payment clears it before
          any new month, and it shows as arrears. No fine is added. It can be changed or removed until a payment is made against it.
        </Text>
      </View>
      {data.startedBilling ? (
        <View style={[styles.notice, styles.noticeWarn]}>
          <Ionicons name="warning-outline" size={15} color={colors.warning} />
          <Text style={styles.noticeText}>A month has already been billed. Balances entered now are added to those bills as arrears.</Text>
        </View>
      ) : null}

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Flats with a balance</Text>
          <Text style={styles.tileValue}>{data.totals.withBalance} of {data.totals.flats}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Still owed</Text>
          <Text style={styles.tileValue}>{inr(data.totals.pending)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.dateRow} onPress={() => setShowPicker(true)} activeOpacity={0.7} accessibilityLabel="Records are correct up to">
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.tileLabel}>Records are correct up to</Text>
          <Text style={styles.dateText}>
            {new Date(`${asOfDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
      {showPicker ? (
        <DateTimePicker
          value={new Date(`${asOfDate}T00:00:00`)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(_: DateTimePickerEvent, date?: Date) => {
            setShowPicker(Platform.OS === 'ios');
            if (date) setAsOf(isoDay(date));
          }}
        />
      ) : null}

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Find a flat or resident"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        accessibilityLabel="Find a flat or resident"
      />
      <View style={styles.toggleRow}>
        <Text style={styles.toggleText}>Only flats with a balance</Text>
        <Switch
          value={onlyWithBalance}
          onValueChange={setOnlyWithBalance}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Opening Balances" subtitle="Dues from paper or Excel" showBack />

      {isLoading ? (
        <LoadingState message="Loading flats…" />
      ) : isError || !data ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load opening balances" description="Pull down to retry." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.flatId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => setEditing(item)}
              activeOpacity={0.7}
              accessibilityLabel={`Opening balance for ${item.flatCode}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.flat}>{item.flatCode}</Text>
                <Text style={styles.resident}>{item.residentName ?? 'No resident'}</Text>
                {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
              </View>
              <View style={styles.right}>
                {item.amount === null ? (
                  <Text style={styles.add}>Add</Text>
                ) : (
                  <>
                    <Text style={styles.amount}>{inr(item.amount)}</Text>
                    <Text style={toNum(item.pendingAmount) > 0 ? styles.owed : styles.cleared}>
                      {toNum(item.pendingAmount) > 0 ? `${inr(item.pendingAmount)} still owed` : 'Cleared'}
                    </Text>
                  </>
                )}
              </View>
              {item.locked ? <Ionicons name="lock-closed-outline" size={15} color={colors.textTertiary} /> : <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<EmptyState icon="home-outline" title="No flat matches" description="Try a different flat code or name." />}
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {editing ? <EditSheet row={editing} asOfDate={asOfDate} onClose={() => setEditing(null)} /> : null}
    </SafeAreaView>
  );
}

const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.xl,
    gap: spacing.sm,
    paddingBottom: 36,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  title: { ...typography.headingSmall, color: colors.text },
  sub: { ...typography.bodySmall, color: colors.textSecondary },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    ...typography.bodyMedium,
    color: colors.text,
  },
  inputBad: { borderColor: colors.error },
  bad: { ...typography.bodySmall, color: colors.error },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  locked: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningLight },
  lockedText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  notice: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.infoLight,
  },
  noticeWarn: { backgroundColor: colors.warningLight },
  noticeText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tileLabel: { ...typography.labelMedium, color: colors.textSecondary },
  tileValue: { ...typography.headingSmall, color: colors.text, marginTop: 2 },
  dateRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  dateText: { ...typography.bodyMedium, color: colors.text },
  search: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, ...typography.bodyMedium, color: colors.text,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { ...typography.bodyMedium, color: colors.textSecondary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginTop: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  flat: { ...typography.labelLarge, color: colors.text },
  resident: { ...typography.bodySmall, color: colors.textSecondary },
  note: { ...typography.bodySmall, color: colors.textTertiary, fontStyle: 'italic' },
  right: { alignItems: 'flex-end' },
  amount: { ...typography.labelLarge, color: colors.text },
  owed: { ...typography.bodySmall, color: colors.error },
  cleared: { ...typography.bodySmall, color: colors.success },
  add: { ...typography.labelMedium, color: colors.primary },
});
