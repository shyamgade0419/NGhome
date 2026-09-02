/**
 * Admin — Accounts
 *
 * Lists society bank/cash accounts with balances, and drills into a single
 * account's transaction ledger. Read-only on mobile: creating and editing
 * accounts stays on the web, where the full form and validation live.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { accountsApi, fundsApi, SocietyAccount } from '@/api/endpoints/accounts.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
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

function LedgerModal({ account, onClose }: { account: SocietyAccount; onClose: () => void }) {
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
            ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

/** Funds are earmarked pools (corpus, sinking fund) held across accounts. */
function FundsTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['funds'],
    queryFn: fundsApi.list,
  });

  if (isLoading) return <LoadingState message="Loading funds…" />;

  const funds = data ?? [];
  const total = funds.reduce((s, f) => s + parseFloat(f.currentBalance ?? '0'), 0);

  return (
    <FlatList
      data={funds}
      keyExtractor={(f) => f.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      ListHeaderComponent={
        funds.length > 0 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerLabel}>Total Across Funds</Text>
            <Text style={styles.bannerValue}>{inr(total)}</Text>
            <Text style={styles.bannerSub}>{funds.length} fund{funds.length === 1 ? '' : 's'}</Text>
          </View>
        ) : null
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }) => {
        const current = parseFloat(item.currentBalance ?? '0');
        return (
          <View style={styles.fundCard}>
            <View style={styles.cardTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.rowMeta} numberOfLines={1}>{item.description}</Text>
                ) : null}
                <Text style={styles.rowMeta}>
                  {item.isVisibleToResidents ? 'Visible to residents' : 'Admin only'}
                </Text>
              </View>
              <Text style={[styles.rowAmount, { color: colors.primary }]}>{inr(current)}</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={
        <EmptyState icon="layers-outline" title="No funds" description="Corpus and sinking funds appear here." />
      }
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

export default function AccountsScreen() {
  const [selected, setSelected] = useState<SocietyAccount | null>(null);
  const [tab, setTab] = useState<'Accounts' | 'Funds'>('Accounts');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  });

  const accounts = data ?? [];
  const total = accounts.reduce((s, a) => s + parseFloat(a.currentBalance ?? '0'), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Accounts & Funds" showBack />

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
        <FundsTab />
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
            <EmptyState icon="wallet-outline" title="No accounts" description="Society accounts are created in the web portal." />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {selected && <LedgerModal account={selected} onClose={() => setSelected(null)} />}
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
});
