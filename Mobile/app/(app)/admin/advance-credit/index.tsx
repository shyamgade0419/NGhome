import React, { useState } from 'react';
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
import { accountsApi } from '@/api/endpoints/accounts.api';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';
import { inr, toNum } from '@/utils/format';
import { parseMoney } from '@/utils/openingBalances';
import { AdvanceCredits } from '@/utils/flatDiscounts';

type Row = AdvanceCredits['flats'][number];

// ── Refund one flat ───────────────────────────────────────────────────────────

function RefundSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({ queryKey: ['accounts-for-refund'], queryFn: accountsApi.list });
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const balance = toNum(row.balance);
  const parsed = parseMoney(amount);
  const list = (accounts ?? []).filter((a: any) => a.isActive !== false);
  const account = list.find((a: any) => a.id === accountId);
  const problem =
    parsed === null || Number.isNaN(parsed) || parsed <= 0 ? 'Enter how much to refund.'
    : parsed > balance ? `The flat holds only ${inr(balance)}.`
    : !accountId ? 'Choose the account it is paid from.'
    : account && toNum(account.currentBalance) < parsed ? `${account.name} holds only ${inr(account.currentBalance)}.`
    : reason.trim().length < 3 ? 'Give a short reason.'
    : null;

  const refund = useMutation({
    mutationFn: () =>
      billingApi.refundAdvance({ flatId: row.flatId, amount: parsed as number, accountId, reason: reason.trim(), ...(reference.trim() ? { referenceNumber: reference.trim() } : {}) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['advance-credits'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
      setTimeout(() => Alert.alert('Refund recorded', `${inr(res.refunded)} refunded to ${res.flatCode}. ${inr(res.remaining)} is still held.`), 400);
    },
    onError: (e: any) => Alert.alert('Could not refund', e?.response?.data?.message ?? 'Please try again.'),
  });

  const confirm = () =>
    Alert.alert('Refund advance', `Pay ${inr(parsed)} back to ${row.flatCode} out of ${account?.name ?? 'the account'}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Refund', style: 'destructive', onPress: () => refund.mutate() },
    ]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={sheet.overlay}>
          <View style={sheet.card}>
            <View style={sheet.header}>
              <View style={{ flex: 1 }}>
                <Text style={sheet.title}>Refund — {row.flatCode}</Text>
                <Text style={sheet.sub}>Holds {inr(balance)} paid ahead</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={sheet.label}>Refund (₹)</Text>
              <TextInput style={sheet.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={String(balance)} placeholderTextColor={colors.textTertiary} accessibilityLabel="Refund amount" />
              <TouchableOpacity onPress={() => setAmount(String(balance))} accessibilityLabel="Refund all of it">
                <Text style={sheet.link}>Refund all of it</Text>
              </TouchableOpacity>

              <Text style={sheet.label}>Paid out of</Text>
              {list.map((a: any) => (
                <TouchableOpacity key={a.id} style={[sheet.option, accountId === a.id && sheet.optionOn]} onPress={() => setAccountId(a.id)} accessibilityLabel={`Pay from ${a.name}`}>
                  <Text style={sheet.optionText}>{a.name}</Text>
                  <Text style={sheet.optionSub}>{inr(a.currentBalance)}</Text>
                </TouchableOpacity>
              ))}

              <Text style={sheet.label}>Reason</Text>
              <TextInput style={sheet.input} value={reason} onChangeText={setReason} maxLength={200} placeholder="Flat sold, advance returned" placeholderTextColor={colors.textTertiary} accessibilityLabel="Reason" />
              <Text style={sheet.label}>UTR or cheque number (optional)</Text>
              <TextInput style={sheet.input} value={reference} onChangeText={setReference} maxLength={100} placeholderTextColor={colors.textTertiary} accessibilityLabel="Reference" />

              {problem ? <Text style={sheet.bad}>{problem}</Text> : null}
              <View style={{ marginTop: spacing.md }}>
                <Button label="Refund" variant="danger" onPress={confirm} loading={refund.isPending} disabled={!!problem} fullWidth />
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AdvanceCreditScreen() {
  const isAdmin = useIsSocietyAdmin();
  const [refunding, setRefunding] = useState<Row | null>(null);
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['advance-credits'],
    queryFn: billingApi.listAdvanceCredits,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Advance Credit" subtitle="Paid ahead by flats" showBack />
      {isLoading ? (
        <LoadingState message="Loading…" />
      ) : isError || !data ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load advance credit" description="Pull down to retry." />
      ) : (
        <FlatList
          data={data.flats}
          keyExtractor={(f) => f.flatId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={15} color={colors.info} />
                <Text style={styles.noticeText}>
                  When a flat pays more than it owes, the extra is kept as an advance and applied to its next bill.
                  {isAdmin ? ' If a flat wants it back instead, refund it here.' : ' Only the admin can refund an advance.'}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Held in advance</Text>
                <Text style={styles.tileValue}>{inr(data.total)}</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.flat}>{item.flatCode}</Text>
                <Text style={styles.resident}>{item.residentName ?? 'No resident'}</Text>
              </View>
              <Text style={styles.amount}>{inr(item.balance)}</Text>
              {isAdmin ? (
                <TouchableOpacity style={styles.refundBtn} onPress={() => setRefunding(item)} accessibilityLabel={`Refund the advance of ${item.flatCode}`}>
                  <Text style={styles.refundText}>Refund</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          ListEmptyComponent={<EmptyState icon="wallet-outline" title="No advance held" description="No flat has paid ahead of what it owes." />}
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
      {refunding ? <RefundSheet row={refunding} onClose={() => setRefunding(null)} /> : null}
    </SafeAreaView>
  );
}

const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl, maxHeight: '90%', paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { ...typography.headingSmall, color: colors.text },
  sub: { ...typography.bodySmall, color: colors.textSecondary },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 4 },
  input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, ...typography.bodyMedium, color: colors.text },
  link: { ...typography.labelMedium, color: colors.primary, marginTop: 6 },
  option: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionText: { ...typography.bodyMedium, color: colors.text },
  optionSub: { ...typography.bodySmall, color: colors.textSecondary },
  bad: { ...typography.bodySmall, color: colors.error, marginTop: spacing.sm },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },
  notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoLight },
  noticeText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  tile: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tileLabel: { ...typography.labelMedium, color: colors.textSecondary },
  tileValue: { ...typography.headingSmall, color: colors.text, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  flat: { ...typography.labelLarge, color: colors.text },
  resident: { ...typography.bodySmall, color: colors.textSecondary },
  amount: { ...typography.labelLarge, color: colors.success },
  refundBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary },
  refundText: { ...typography.labelMedium, color: colors.primary, fontWeight: '600' },
});
