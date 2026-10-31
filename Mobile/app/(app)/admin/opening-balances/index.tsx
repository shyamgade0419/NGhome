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
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr, toNum } from '@/utils/format';
import { OpeningRow, OpeningSaveResult, ParsedLine, filterOpeningRows, isoDay, parseMoney, parseOpeningCsv, saveMessage } from '@/utils/openingBalances';

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

  // A balance a payment has touched cannot be edited; the admin can correct it, with a reason.
  const isAdmin = useIsSocietyAdmin();
  const [correcting, setCorrecting] = useState(false);
  const [fixAmount, setFixAmount] = useState('');
  const [fixReason, setFixReason] = useState('');
  const fixParsed = parseMoney(fixAmount);
  const fixProblem =
    fixParsed === null || Number.isNaN(fixParsed) || fixParsed <= 0 ? 'Enter what the flat really owed.'
    : fixParsed === toNum(row.amount) ? 'That is the amount already recorded.'
    : fixReason.trim().length < 3 ? 'Give a short reason.'
    : null;
  const correct = useMutation({
    mutationFn: () => billingApi.correctOpeningBalance(row.flatId, { amount: fixParsed as number, reason: fixReason.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
      onClose();
      const moved = toNum(res.movedToAdvance);
      setTimeout(
        () => Alert.alert('Corrected', moved > 0 ? `${inr(moved)} was paid in excess and is now the flat's advance.` : 'The opening balance has been corrected.'),
        400,
      );
    },
    onError: (e: any) => Alert.alert('Could not correct', e?.response?.data?.message ?? 'Please try again.'),
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
            ) : null}
            {row.locked && isAdmin ? (
              correcting ? (
                <>
                  <Text style={sheet.label}>What the flat really owed (₹)</Text>
                  <TextInput style={sheet.input} value={fixAmount} onChangeText={setFixAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary} accessibilityLabel="Corrected amount" />
                  <Text style={sheet.label}>Reason (kept in the audit log)</Text>
                  <TextInput style={sheet.input} value={fixReason} onChangeText={setFixReason} maxLength={200} placeholder="Ledger page 14 was misread" placeholderTextColor={colors.textTertiary} accessibilityLabel="Correction reason" />
                  <Text style={sheet.hint}>If the true amount is less than what was paid, the extra becomes the flat&apos;s advance. If it is more, the flat owes the rest.</Text>
                  {fixProblem ? <Text style={sheet.bad}>{fixProblem}</Text> : null}
                  <View style={sheet.actions}>
                    <View style={{ flex: 1 }}>
                      <Button label="Correct balance" onPress={() => correct.mutate()} loading={correct.isPending} disabled={!!fixProblem} fullWidth />
                    </View>
                  </View>
                </>
              ) : (
                <View style={sheet.actions}>
                  <View style={{ flex: 1 }}>
                    <Button label="Correct the amount" variant="outline" onPress={() => setCorrecting(true)} fullWidth />
                  </View>
                </View>
              )
            ) : null}
            {row.locked ? null : (
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

// ── Load balances from a file ────────────────────────────────────────────────

interface LoadedFile {
  name: string;
  lines: ParsedLine[];
  /** What was sent to be checked: the lines with an amount and a flat, in order. */
  sendable: { flatCode: string; amount: number; note?: string }[];
  preview: OpeningSaveResult | null;
}

function ImportSheet({ loaded, asOfDate, onClose }: { loaded: LoadedFile; asOfDate: string; onClose: () => void }) {
  const qc = useQueryClient();
  const sentLines = loaded.lines.filter((l) => !l.error);
  const fileLine = (row: number) => sentLines[row - 1]?.line ?? row;
  const fileProblems = loaded.lines.filter((l) => l.error);
  const serverProblems = (loaded.preview?.results ?? []).filter((r) => r.action === 'REJECTED');
  const willSave = loaded.preview ? loaded.preview.summary.created + loaded.preview.summary.updated + loaded.preview.summary.removed : 0;
  const same = loaded.preview?.summary.unchanged ?? 0;
  const problems = [
    ...fileProblems.map((l) => ({ line: l.line, text: `${l.flatCode || '—'}: ${l.error}` })),
    ...serverProblems.map((r) => ({ line: fileLine(r.row), text: `${r.flatCode || '—'}: ${r.message}` })),
  ].sort((a, b) => a.line - b.line);

  const save = useMutation({
    mutationFn: () => billingApi.saveOpeningBalances({ asOfDate, rows: loaded.sendable }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
      onClose();
      setTimeout(() => Alert.alert(res.summary.rejected > 0 ? 'Partly saved' : 'Saved', saveMessage(res)), 400);
    },
    onError: (e: any) => Alert.alert('Could not save', e?.response?.data?.message ?? 'Please try again.'),
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheet.overlay}>
        <View style={sheet.card}>
          <View style={sheet.header}>
            <View style={{ flex: 1 }}>
              <Text style={sheet.title}>Load from a file</Text>
              <Text style={sheet.sub} numberOfLines={1}>{loaded.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={sheet.summary}>
            {willSave} to save{same > 0 ? ` · ${same} already the same` : ''}{problems.length > 0 ? ` · ${problems.length} with a problem` : ''}
          </Text>
          {problems.length > 0 ? (
            <View style={sheet.problems}>
              {problems.slice(0, 8).map((pr) => (
                <Text key={`${pr.line}`} style={sheet.problemText}>Row {pr.line} — {pr.text}</Text>
              ))}
              {problems.length > 8 ? <Text style={sheet.problemText}>…and {problems.length - 8} more</Text> : null}
              <Text style={sheet.hint}>Rows with a problem are skipped. Fix them in the file and load it again, or save just the ones that are ready.</Text>
            </View>
          ) : null}
          <View style={{ marginTop: spacing.md }}>
            <Button label={`Save ${willSave} balance${willSave === 1 ? '' : 's'}`} onPress={() => save.mutate()} loading={save.isPending} disabled={willSave === 0} fullWidth />
          </View>
        </View>
      </View>
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
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [reading, setReading] = useState(false);

  const today = isoDay(new Date());
  const asOfDate = asOf || (data?.asOfDate ? data.asOfDate.slice(0, 10) : today);
  const rows = useMemo(() => filterOpeningRows(data?.rows ?? [], search, onlyWithBalance), [data, search, onlyWithBalance]);

  // Pick a CSV (Excel: File > Save As > CSV), read it, and have the server check it before anything is saved.
  const loadFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setReading(true);
      const asset = res.assets[0];
      const parsed = parseOpeningCsv(await FileSystem.readAsStringAsync(asset.uri));
      if (parsed.missing) { Alert.alert('Cannot read this file', parsed.missing); return; }
      if (parsed.lines.length === 0) { Alert.alert('Nothing to load', 'No flat in the file has an amount.'); return; }
      const sendable = parsed.lines
        .filter((l) => !l.error && l.amount !== null)
        .map((l) => ({ flatCode: l.flatCode, amount: l.amount as number, ...(l.note ? { note: l.note } : {}) }));
      const preview = sendable.length > 0 ? await billingApi.saveOpeningBalances({ asOfDate, rows: sendable, dryRun: true }) : null;
      setLoaded({ name: asset.name, lines: parsed.lines, sendable, preview });
    } catch {
      Alert.alert('Could not read the file', 'Save it as CSV (comma separated) from Excel, and try again.');
    } finally {
      setReading(false);
    }
  };

  const header = data ? (
    <View style={styles.header}>
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={15} color={colors.info} />
        <Text style={styles.noticeText}>
          Enter what each flat owed on your paper or Excel records. It becomes the flat&apos;s oldest due: a payment clears it before
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

      <TouchableOpacity style={styles.loadBtn} onPress={loadFile} disabled={reading} activeOpacity={0.7} accessibilityLabel="Load balances from a file">
        <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.loadTitle}>{reading ? 'Reading the file…' : 'Load from a file'}</Text>
          <Text style={styles.loadSub}>A CSV with Flat, Amount and Note columns</Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
      </TouchableOpacity>

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

      {loaded ? <ImportSheet loaded={loaded} asOfDate={asOfDate} onClose={() => setLoaded(null)} /> : null}
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
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  locked: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningLight },
  lockedText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  summary: { ...typography.labelLarge, color: colors.text, marginTop: spacing.sm },
  problems: { marginTop: spacing.sm, gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorLight },
  problemText: { ...typography.bodySmall, color: colors.text },
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
  loadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  loadTitle: { ...typography.labelLarge, color: colors.text },
  loadSub: { ...typography.bodySmall, color: colors.textSecondary },
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
