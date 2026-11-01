/**
 * Admin — Accounts & Funds
 *
 * Lists society bank/cash accounts with balances and drills into a single
 * account's transaction ledger. Both accounts and funds can be created here —
 * neither could be created anywhere in the product before, which left a new
 * society unable to approve a single payment (approval asks which account the
 * money landed in) or to set up a corpus fund at all.
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
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsApi, fundsApi, SocietyAccount, SocietyFund, AccountType, FundKind, FundSummary } from '@/api/endpoints/accounts.api';
import { adjustmentEffect, adjustmentProblem, AdjustDirection } from '@/utils/adjustments';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { inr as inrExact } from '@/utils/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

function inr(v: string | number | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  SAVINGS: 'wallet-outline',
  CURRENT: 'business-outline',
  FIXED_DEPOSIT: 'lock-closed-outline',
  CASH: 'cash-outline',
  OTHER: 'ellipsis-horizontal-circle-outline',
};

// ── Transactions sheet ───────────────────────────────────────────────────────

function LedgerModal({ account, onClose, onAdjust }: { account: SocietyAccount; onClose: () => void; onAdjust: () => void }) {
  const qc = useQueryClient();
  const isAdmin = useIsSocietyAdmin();
  const remove = useMutation({
    mutationFn: () => accountsApi.remove(account.id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      Alert.alert(
        res.removedFromLists ? 'Account removed' : 'Account deleted',
        res.removedFromLists
          ? `${res.name} is off your accounts and totals. Its history is kept.`
          : `${res.name} is deleted.`,
      );
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not delete the account.'),
  });
  const askDelete = () =>
    Alert.alert(
      `Delete ${account.name}?`,
      'If nothing has been recorded against it, it is deleted. If payments or expenses have already used it, it is taken off your accounts and totals instead and its history is kept. You can add the account again with the right balance.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
      ],
    );
  const { data, isLoading } = useQuery({
    queryKey: ['account-transactions', account.id],
    queryFn: () => accountsApi.transactions(account.id, { limit: 50 }),
  });

  const txns = data?.data ?? [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{account.name}</Text>
            <Text style={styles.modalSub}>{inr(account.currentBalance)} current balance</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <LoadingState message="Loading transactions…" />
        ) : (
          <FlatList
            data={txns}
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item }) => {
              const credit = /CREDIT|DEPOSIT|IN/i.test(item.transactionType);
              return (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.description ?? item.transactionType.replace(/_/g, ' ')}</Text>
                    <Text style={styles.rowMeta}>
                      {new Date(item.transactionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {item.referenceNumber ? ` · ${item.referenceNumber}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, { color: credit ? colors.success : colors.error }]}>
                    {credit ? '+' : '−'}{inr(item.amount)}
                  </Text>
                </View>
              );
            }}
            ListEmptyComponent={
              <EmptyState icon="receipt-outline" title="No transactions" description="This account has no recorded movement yet." />
            }
            ListFooterComponent={
              <View style={{ paddingBottom: spacing['3xl'] }}>
                {isAdmin ? (
                  <TouchableOpacity
                    style={styles.adjustBtn}
                    onPress={onAdjust}
                    activeOpacity={0.8}
                    accessibilityLabel="Adjust balance"
                  >
                    <Ionicons name="options-outline" size={16} color={colors.primary} />
                    <Text style={styles.addMoneyText}>Adjust balance to match the bank</Text>
                  </TouchableOpacity>
                ) : null}
                {isAdmin ? (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={askDelete}
                    disabled={remove.isPending}
                    activeOpacity={0.8}
                    accessibilityLabel="Delete account"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={styles.deleteText}>{remove.isPending ? 'Deleting…' : 'Delete this account'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Account create ───────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'CURRENT', label: 'Current' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CASH', label: 'Cash' },
  { value: 'FIXED_DEPOSIT', label: 'Fixed Deposit' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * Until this existed there was no way to create an account from anywhere in
 * the product, and registering a society creates none. Approving a payment
 * asks which account the money landed in, so a new society could collect real
 * money by UPI and never record a rupee of it — approval simply failed with
 * "No account available to credit".
 *
 * Bank details here are for humans reading the screen. Nothing connects to a
 * bank: the balance moves only as payments are approved and expenses and
 * salaries are paid.
 */
function NewAccountModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('CURRENT');
  const [bankName, setBankName] = useState('');
  const [accountNumberMasked, setAccountNumberMasked] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');

  const isCash = accountType === 'CASH';

  const mutation = useMutation({
    mutationFn: () =>
      accountsApi.create({
        name: name.trim(),
        accountType,
        bankName: isCash ? undefined : bankName.trim() || undefined,
        accountNumberMasked: isCash ? undefined : accountNumberMasked.trim() || undefined,
        ifscCode: isCash ? undefined : ifscCode.trim().toUpperCase() || undefined,
        openingBalance: openingBalance ? parseFloat(openingBalance) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to create account.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { flex: 1 }]}>New Account</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Account Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. HDFC Current A/c, Petty Cash"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {ACCOUNT_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.chip, accountType === t.value && styles.chipActive]}
                  onPress={() => setAccountType(t.value)}
                >
                  <Text style={[styles.chipText, accountType === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {!isCash && (
              <>
                <Text style={[styles.label, { marginTop: spacing.base }]}>Bank Name</Text>
                <TextInput
                  style={styles.input}
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="e.g. HDFC Bank"
                  placeholderTextColor={colors.textTertiary}
                />

                <Text style={[styles.label, { marginTop: spacing.base }]}>Account Number</Text>
                <Text style={styles.hint}>
                  Last few digits are enough — this is only so people recognise the account.
                </Text>
                <TextInput
                  style={styles.input}
                  value={accountNumberMasked}
                  onChangeText={setAccountNumberMasked}
                  placeholder="e.g. XXXX4321"
                  placeholderTextColor={colors.textTertiary}
                />

                <Text style={[styles.label, { marginTop: spacing.base }]}>IFSC Code</Text>
                <TextInput
                  style={styles.input}
                  value={ifscCode}
                  onChangeText={setIfscCode}
                  placeholder="e.g. HDFC0001234"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="characters"
                />
              </>
            )}

            <Text style={[styles.label, { marginTop: spacing.base }]}>Opening Balance (₹)</Text>
            <Text style={styles.hint}>
              What this account holds today. Payments and expenses move it from here.
            </Text>
            <TextInput
              style={styles.input}
              value={openingBalance}
              onChangeText={(v) => setOpeningBalance(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />

            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.noteText}>
                This is a record for tracking money, not a connection to your bank. The balance
                changes as you approve payments and pay expenses.
              </Text>
            </View>

            <Button
              label={mutation.isPending ? 'Creating…' : 'Create Account'}
              onPress={() => {
                if (!name.trim()) {
                  Alert.alert('Required', 'Enter an account name.');
                  return;
                }
                mutation.mutate();
              }}
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

// ── Fund create / contribute ─────────────────────────────────────────────────

function NewFundModal({ onClose, initialKind, hasCorpus }: { onClose: () => void; initialKind: FundKind; hasCorpus: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<FundKind>(initialKind);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  // Defaults to off: this is the only control over whether residents see this
  // fund, so exposure should be a deliberate act rather than something that
  // happens because a default was left alone.
  const [isVisibleToResidents, setIsVisibleToResidents] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      fundsApi.create({
        kind,
        name: name.trim(),
        description: description.trim() || undefined,
        openingBalance: openingBalance ? parseFloat(openingBalance) : undefined,
        isVisibleToResidents,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to create fund.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { flex: 1 }]}>{kind === 'CORPUS' ? 'New Corpus Fund' : 'New Fund'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Kind of fund</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {([
                { value: 'OTHER' as FundKind, label: 'Other fund' },
                ...(hasCorpus ? [] : [{ value: 'CORPUS' as FundKind, label: 'Corpus fund' }]),
              ]).map((k) => (
                <TouchableOpacity
                  key={k.value}
                  style={[styles.chip, kind === k.value && styles.chipActive]}
                  onPress={() => setKind(k.value)}
                  accessibilityLabel={`Kind ${k.label}`}
                >
                  <Text style={[styles.chipText, kind === k.value && styles.chipTextActive]}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.hint}>
              A fund is money set aside inside your accounts, not extra money: it comes out of the maintenance and
              general money shown on the Funds tab.
            </Text>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Fund Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={kind === 'CORPUS' ? 'Corpus Fund' : 'e.g. Festival Fund, Sinking Fund'}
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Description</Text>
            <TextInput
              style={styles.input}
              value={description}
              onChangeText={setDescription}
              placeholder="What this fund is for"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Opening Balance (₹)</Text>
            <Text style={styles.hint}>
              What the fund already holds today. Later additions go through Add Money.
            </Text>
            <TextInput
              style={styles.input}
              value={openingBalance}
              onChangeText={(v) => setOpeningBalance(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Visible to Residents</Text>
                <Text style={styles.hint}>
                  Shows this fund and its balance on the resident Society Finances screen.
                </Text>
              </View>
              <Switch
                value={isVisibleToResidents}
                onValueChange={setIsVisibleToResidents}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            <Button
              label={mutation.isPending ? 'Creating…' : 'Create Fund'}
              onPress={() => {
                if (!name.trim()) {
                  Alert.alert('Required', 'Enter a fund name.');
                  return;
                }
                mutation.mutate();
              }}
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

type AdjustTarget = { kind: 'fund'; item: SocietyFund } | { kind: 'account'; item: SocietyAccount };

/**
 * Raising or lowering a fund, or correcting a bank balance, always with a comment. A fund is an earmark inside
 * the bank accounts, so by default only the fund moves; naming a bank account (money that really arrived in it
 * or left it, and was not recorded as a payment or expense) moves that too. The preview says what each choice
 * does to the bank and to the general money before anything is saved.
 */
function AdjustModal({ target, general, onClose }: { target: AdjustTarget; general: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isAdmin = useIsSocietyAdmin();
  const isFund = target.kind === 'fund';
  const [direction, setDirection] = useState<AdjustDirection>('INCREASE');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [alsoCreditAccount, setAlsoCreditAccount] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });

  const balance = parseFloat(target.item.currentBalance ?? '0');

  const mutation = useMutation({
    mutationFn: async () => {
      const body = { direction, amount: Number(amount), comment: comment.trim() };
      if (target.kind === 'fund') {
        await fundsApi.adjust(target.item.id, { ...body, accountId: alsoCreditAccount && accountId ? accountId : undefined });
      } else {
        await accountsApi.adjust(target.item.id, body);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funds'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['fund-summary'] });
      qc.invalidateQueries({ queryKey: ['fund-history'] });
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Could not save the change.'),
  });

  const effect = adjustmentEffect({
    kind: target.kind,
    name: target.item.name,
    direction,
    amount,
    balance,
    general,
    bankMoves: isFund && alsoCreditAccount && !!accountId,
  });

  const submit = () => {
    const problem = adjustmentProblem(amount, comment, direction, balance);
    if (problem) {
      Alert.alert('Check the details', problem);
      return;
    }
    if (isFund && alsoCreditAccount && !accountId) {
      Alert.alert('Required', 'Pick which bank account this money went into or came out of.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{isFund ? 'Add / Remove Money' : 'Adjust Balance'}</Text>
            <Text style={styles.rowMeta}>{target.item.name} · {inrExact(balance, { decimals: true })} now</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row' }}>
              {([['INCREASE', 'Add money'], ['DECREASE', 'Remove money']] as const).map(([d, label]) => {
                const locked = d === 'DECREASE' && !isAdmin;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.chip, direction === d && styles.chipActive, locked && { opacity: 0.5 }]}
                    onPress={() => (locked ? Alert.alert('Admin only', 'Only the admin can take money out.') : setDirection(d))}
                    accessibilityLabel={label}
                  >
                    <Text style={[styles.chipText, direction === d && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Amount"
              autoFocus
            />

            <Text style={[styles.label, { marginTop: spacing.base }]}>Comment: why is this being changed? *</Text>
            <TextInput
              style={styles.input}
              value={comment}
              onChangeText={setComment}
              placeholder={isFund ? 'e.g. Donations collected for Ganesh festival' : 'e.g. Interest credited by the bank'}
              placeholderTextColor={colors.textTertiary}
              maxLength={500}
              accessibilityLabel="Comment"
            />

            {isFund && (
              <>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{direction === 'INCREASE' ? 'Also add it to a bank account' : 'Also take it from a bank account'}</Text>
                    <Text style={styles.hint}>
                      Only if money really came into, or went out of, an account now and was not recorded as a payment
                      or an expense. Otherwise leave this off, or the same money is counted twice.
                    </Text>
                  </View>
                  <Switch
                    value={alsoCreditAccount}
                    onValueChange={setAlsoCreditAccount}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    accessibilityLabel="Also move a bank account"
                  />
                </View>
                {alsoCreditAccount && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    {(accounts ?? []).map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, accountId === a.id && styles.chipActive]}
                        onPress={() => setAccountId(a.id)}
                      >
                        <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {effect ? (
              <View style={styles.noteBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.noteText}>{effect}</Text>
              </View>
            ) : null}

            <Button
              label={mutation.isPending ? 'Saving…' : !isFund ? 'Save balance' : direction === 'INCREASE' ? 'Add to fund' : 'Take from fund'}
              onPress={submit}
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

/** Every entry that has moved a fund, newest first, with the comment each was made with. */
function FundHistoryModal({ fund, onClose }: { fund: SocietyFund; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['fund-history', fund.id], queryFn: () => fundsApi.history(fund.id) });
  const entries = data?.entries ?? [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>History · {fund.name}</Text>
            <Text style={styles.modalSub}>
              Opened with {inrExact(data?.fund.openingBalance ?? fund.openingBalance, { decimals: true })} · holds{' '}
              {inrExact(data?.fund.currentBalance ?? fund.currentBalance, { decimals: true })} now
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <LoadingState message="Loading history…" />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.description}</Text>
                  <Text style={styles.rowMeta}>
                    {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {item.by ? ` · ${item.by}` : ''}
                    {item.movedBankAccount ? ' · bank account moved too' : ''}
                  </Text>
                </View>
                <Text style={[styles.rowAmount, { color: item.direction === 'IN' ? colors.success : colors.error }]}>
                  {item.direction === 'IN' ? '+' : '−'}{inrExact(item.amount, { decimals: true })}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <EmptyState icon="receipt-outline" title="No entries yet" description="Nothing has been added or taken out since it was opened." />
            }
            ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * The bank total, split into the corpus, every other fund and what is left, so the parts visibly add up to it.
 * A fund is set aside inside the accounts, so what is left is the bank minus the funds; if that goes negative
 * the funds claim more than the bank holds and something needs checking.
 */
function MoneyPicture({ money }: { money: FundSummary }) {
  const Line = ({ label, sub, value, strong }: { label: string; sub?: string; value: string; strong?: boolean }) => (
    <View style={styles.pictureRow}>
      <View style={{ flex: 1 }}>
        <Text style={strong ? styles.pictureStrong : styles.pictureLabel}>{label}</Text>
        {sub ? <Text style={styles.rowMeta}>{sub}</Text> : null}
      </View>
      <Text style={strong ? styles.pictureStrong : styles.pictureValue}>{inrExact(value, { decimals: true })}</Text>
    </View>
  );

  return (
    <View style={styles.picture} accessibilityLabel="Where the money is">
      <View style={styles.pictureHead}>
        <Text style={styles.pictureTitle}>Where the money is</Text>
        <Text style={[styles.pictureBadge, { color: money.fundsExceedBank ? colors.error : colors.success }]}>
          {money.fundsExceedBank ? 'Funds are more than the bank' : 'Adds up to the bank'}
        </Text>
      </View>
      <Line label="In the bank accounts" sub={`${money.accounts.length} active account${money.accounts.length === 1 ? '' : 's'}`} value={money.bankTotal} strong />
      <View style={styles.pictureIndent}>
        <Line
          label="Corpus fund"
          sub={money.corpus.funds.length === 0 ? 'No corpus fund yet' : money.corpus.funds.map((f) => f.name).join(', ')}
          value={money.corpus.total}
        />
        {money.other.funds.length === 0 ? (
          <Line label="Other funds" sub="None yet" value={money.other.total} />
        ) : (
          money.other.funds.map((f) => <Line key={f.id} label={f.name} sub="Other fund" value={f.balance} />)
        )}
        <Line label="Maintenance and general money" sub="What the bank holds that no fund has set aside" value={money.generalBalance} strong />
      </View>
      <Text style={styles.hint}>
        {money.fundsExceedBank
          ? `The funds add up to ${inrExact(Math.abs(parseFloat(money.generalBalance)), { decimals: true })} more than the bank holds, so this does not reconcile yet. If the bank really holds more, open the account and tap Adjust balance. If a fund was entered too high, tap Add / Remove on it. Each change keeps your comment.`
          : 'Corpus + other funds + maintenance and general money = what is in the bank.'}
      </Text>
    </View>
  );
}

/** Funds are earmarked pools (corpus, sinking fund) held across accounts. */
function FundsTab({
  onNewFund,
  onAdjust,
  onHistory,
}: {
  onNewFund: () => void;
  onAdjust: (fund: SocietyFund) => void;
  onHistory: (fund: SocietyFund) => void;
}) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['funds'],
    queryFn: fundsApi.list,
  });
  const { data: money, refetch: refetchMoney } = useQuery({
    queryKey: ['fund-summary'],
    queryFn: fundsApi.summary,
  });

  if (isLoading) return <LoadingState message="Loading funds…" />;

  const funds = data ?? [];
  const total = funds.reduce((s, f) => s + parseFloat(f.currentBalance ?? '0'), 0);

  return (
    <FlatList
      data={funds}
      keyExtractor={(f) => f.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); refetchMoney(); }} tintColor={colors.primary} />}
      ListHeaderComponent={
        <>
          {money ? <MoneyPicture money={money} /> : null}
          {funds.length > 0 ? (
            <View style={styles.banner}>
              <Text style={styles.bannerLabel}>Total Across Funds</Text>
              <Text style={styles.bannerValue}>{inr(total)}</Text>
              <Text style={styles.bannerSub}>{funds.length} fund{funds.length === 1 ? '' : 's'}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.addFundBtn} onPress={onNewFund} activeOpacity={0.8} accessibilityLabel="Add another fund">
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.addMoneyText}>Add another fund</Text>
          </TouchableOpacity>
        </>
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }) => {
        const current = parseFloat(item.currentBalance ?? '0');
        return (
          <View style={styles.fundCard}>
            <View style={styles.cardTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>{item.kind === 'CORPUS' ? 'Corpus fund' : 'Other fund'}</Text>
                {item.description ? (
                  <Text style={styles.rowMeta} numberOfLines={1}>{item.description}</Text>
                ) : null}
                <Text style={styles.rowMeta}>
                  {item.isVisibleToResidents ? 'Visible to residents' : 'Admin only'}
                </Text>
              </View>
              <Text style={[styles.rowAmount, { color: colors.primary }]}>{inr(current)}</Text>
            </View>
            <View style={styles.fundButtons}>
              <TouchableOpacity
                style={[styles.addMoneyBtn, { flex: 1 }]}
                onPress={() => onAdjust(item)}
                activeOpacity={0.8}
                accessibilityLabel={`Add or remove money for ${item.name}`}
              >
                <Ionicons name="options-outline" size={16} color={colors.primary} />
                <Text style={styles.addMoneyText}>Add / Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addMoneyBtn, { flex: 1 }]}
                onPress={() => onHistory(item)}
                activeOpacity={0.8}
                accessibilityLabel={`History of ${item.name}`}
              >
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={styles.addMoneyText}>History</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="layers-outline"
          title="No funds"
          description="Corpus and sinking funds appear here."
          actionLabel="Create Fund"
          onAction={onNewFund}
        />
      }
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

export default function AccountsScreen() {
  const [selected, setSelected] = useState<SocietyAccount | null>(null);
  const [tab, setTab] = useState<'Accounts' | 'Funds'>('Accounts');
  const [showNewFund, setShowNewFund] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const { data: fundList } = useQuery({ queryKey: ['funds'], queryFn: fundsApi.list });
  const hasCorpus = (fundList ?? []).some((fnd) => fnd.kind === 'CORPUS');
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [historyFund, setHistoryFund] = useState<SocietyFund | null>(null);
  const { data: money } = useQuery({ queryKey: ['fund-summary'], queryFn: fundsApi.summary });

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  });

  const accounts = data ?? [];
  const total = accounts.reduce((s, a) => s + parseFloat(a.currentBalance ?? '0'), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Accounts & Funds"
        showBack
        rightAction={
          <TouchableOpacity
            onPress={() => (tab === 'Funds' ? setShowNewFund(true) : setShowNewAccount(true))}
            hitSlop={12}
          >
            <Ionicons name="add" size={26} color={colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.tabBar}>
        {(['Accounts', 'Funds'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Funds' ? (
        <FundsTab
          onNewFund={() => setShowNewFund(true)}
          onAdjust={(fund) => setAdjustTarget({ kind: 'fund', item: fund })}
          onHistory={setHistoryFund}
        />
      ) : isLoading ? (
        <LoadingState message="Loading accounts…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load accounts" description="Pull down to retry." />
      ) : (
        <FlatList
          data={accounts}
          keyExtractor={(a) => a.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={
            accounts.length > 0 ? (
              <View style={styles.banner}>
                <Text style={styles.bannerLabel}>Total Balance</Text>
                <Text style={styles.bannerValue}>{inr(total)}</Text>
                <Text style={styles.bannerSub}>
                  across {accounts.length} account{accounts.length === 1 ? '' : 's'}
                </Text>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={() => setSelected(item)}>
              <View style={styles.iconWrap}>
                <Ionicons name={TYPE_ICON[item.accountType] ?? 'wallet-outline'} size={19} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.accountType?.replace(/_/g, ' ')}
                  {item.bankName ? ` · ${item.bankName}` : ''}
                  {item.accountNumberMasked ? ` · ${item.accountNumberMasked}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.rowAmount, { color: colors.primary }]}>{inr(item.currentBalance)}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title="No accounts yet"
              description="Add the bank account or cash box your society's money goes into. You need at least one before you can approve any payment."
              actionLabel="Create Account"
              onAction={() => setShowNewAccount(true)}
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {selected && (
        <LedgerModal
          account={selected}
          onClose={() => setSelected(null)}
          onAdjust={() => { setAdjustTarget({ kind: 'account', item: selected }); setSelected(null); }}
        />
      )}
      {showNewFund && <NewFundModal onClose={() => setShowNewFund(false)} initialKind="OTHER" hasCorpus={hasCorpus} />}
      {showNewAccount && <NewAccountModal onClose={() => setShowNewAccount(false)} />}
      {adjustTarget && (
        <AdjustModal
          target={adjustTarget}
          general={money ? parseFloat(money.generalBalance) : null}
          onClose={() => setAdjustTarget(null)}
        />
      )}
      {historyFund && <FundHistoryModal fund={historyFund} onClose={() => setHistoryFund(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

  banner: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: 3,
    marginBottom: spacing.md,
  },
  bannerLabel: { ...typography.labelMedium, color: 'rgba(255,255,255,0.8)' },
  bannerValue: { ...typography.displaySmall, color: '#fff', fontWeight: '700' },
  bannerSub: { ...typography.bodySmall, color: 'rgba(255,255,255,0.75)' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  rowAmount: { ...typography.labelLarge, fontWeight: '700' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },

  fundCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.sm,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.secondary },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },

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
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.base,
  },
  chipScroll: { marginTop: 6, marginBottom: spacing.sm },

  picture: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, marginBottom: spacing.md, gap: 4,
  },
  pictureHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  pictureTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '700' },
  pictureBadge: { ...typography.labelSmall, fontWeight: '600' },
  pictureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 5 },
  pictureIndent: { paddingLeft: spacing.base },
  pictureLabel: { ...typography.bodyMedium, color: colors.text },
  pictureValue: { ...typography.bodyMedium, color: colors.text },
  pictureStrong: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  addFundBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelSmall, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },

  addMoneyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.primaryLight,
  },
  addMoneyText: { ...typography.labelMedium, color: colors.primary },
  fundButtons: { flexDirection: 'row', gap: spacing.sm },
  adjustBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.xl, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
  },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.xl, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
  },
  deleteText: { ...typography.labelMedium, color: colors.error },

  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginTop: spacing.base,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  noteText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, lineHeight: 18 },
});
