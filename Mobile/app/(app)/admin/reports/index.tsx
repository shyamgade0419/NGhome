/**
 * Admin — Reports
 *
 * Four report tabs mirroring the web Reports page. Note the API is not
 * internally consistent about serialization: outstanding-dues and
 * expense-summary return numbers, collection-summary returns strings.
 * The api module types that faithfully rather than papering over it.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { reportsApi, OutstandingBill } from '@/api/endpoints/reports.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

const TABS = ['Dues', 'Collection', 'Expenses', 'Balances'] as const;
type Tab = typeof TABS[number];

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inr(n: number | string | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(v)) return '₹0';
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ── Summary banner ───────────────────────────────────────────────────────────

function Banner({ label, value, sub, tone = 'primary' }: {
  label: string; value: string; sub?: string; tone?: 'primary' | 'warning' | 'success';
}) {
  const bg =
    tone === 'warning' ? colors.warning : tone === 'success' ? colors.secondary : colors.primary;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={styles.bannerLabel}>{label}</Text>
      <Text style={styles.bannerValue}>{value}</Text>
      {sub ? <Text style={styles.bannerSub}>{sub}</Text> : null}
    </View>
  );
}

// ── Outstanding dues ─────────────────────────────────────────────────────────

function DuesTab() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['report-dues'],
    queryFn: reportsApi.outstandingDues,
  });

  if (isLoading) return <LoadingState message="Loading dues…" />;
  if (isError || !data) {
    return <EmptyState icon="alert-circle-outline" title="Couldn't load report" description="Pull down to retry." />;
  }

  const bills = data.bills ?? [];

  return (
    <FlatList
      data={bills}
      keyExtractor={(b) => b.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      ListHeaderComponent={
        <Banner
          label="Total Outstanding"
          value={inr(data.totalOutstanding)}
          sub={`${bills.length} unpaid bill${bills.length === 1 ? '' : 's'}`}
          tone="warning"
        />
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }: { item: OutstandingBill }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Flat {item.flatCode}</Text>
            {item.residentName ? <Text style={styles.rowSub}>{item.residentName}</Text> : null}
            <Text style={styles.rowMeta}>
              {item.invoiceNumber} · due {new Date(item.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.rowAmount, { color: colors.warning }]}>{inr(item.pendingAmount)}</Text>
            <Text style={styles.rowMeta}>of {inr(item.totalAmount)}</Text>
          </View>
        </View>
      )}
      ListEmptyComponent={
        <EmptyState icon="checkmark-circle-outline" title="No outstanding dues" description="Every published bill is paid." />
      }
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

// ── Collection summary ───────────────────────────────────────────────────────

function CollectionTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['report-collection', year, month],
    queryFn: () => reportsApi.collectionSummary(year, month),
  });

  const step = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
    >
      {/* Month stepper */}
      <View style={styles.stepper}>
        <TouchableOpacity onPress={() => step(-1)} hitSlop={8} style={styles.stepBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.stepLabel}>{MONTHS[month]} {year}</Text>
        <TouchableOpacity onPress={() => step(1)} hitSlop={8} style={styles.stepBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <LoadingState message="Loading…" />
      ) : !data || data.error ? (
        <EmptyState
          icon="calendar-outline"
          title="No billing period"
          description={`No billing period exists for ${MONTHS[month]} ${year}.`}
        />
      ) : (
        <>
          <Banner label="Collected" value={inr(data.totalCollected)} sub={`Collection rate ${data.collectionRate ?? '—'}`} tone="success" />
          <View style={{ height: spacing.md }} />
          <View style={styles.statGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Billed</Text>
              <Text style={[styles.statValue, { color: colors.primary }]}>{inr(data.totalBilled)}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Pending</Text>
              <Text style={[styles.statValue, { color: colors.warning }]}>{inr(data.totalPending)}</Text>
            </View>
          </View>
        </>
      )}
      <View style={{ height: spacing['3xl'] }} />
    </ScrollView>
  );
}

// ── Expense summary ──────────────────────────────────────────────────────────

function ExpensesTab() {
  const now = new Date();
  const from = `${now.getFullYear()}-01-01`;
  const to = now.toISOString().split('T')[0];

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['report-expenses', from, to],
    queryFn: () => reportsApi.expenseSummary(from, to),
  });

  if (isLoading) return <LoadingState message="Loading expenses…" />;

  const cats = data?.byCategory ?? [];
  const max = cats.length ? Math.max(...cats.map((c) => c.total)) : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
    >
      <Banner
        label={`Expenses since 1 Jan ${now.getFullYear()}`}
        value={inr(data?.total)}
        sub={`${data?.count ?? 0} approved or paid expense${data?.count === 1 ? '' : 's'}`}
      />
      <View style={{ height: spacing.md }} />

      {cats.length === 0 ? (
        <EmptyState icon="wallet-outline" title="No expenses" description="Nothing approved or paid in this range." />
      ) : (
        cats.map((c) => (
          <View key={c.category} style={styles.catRow}>
            <View style={styles.catTop}>
              <Text style={styles.catName}>{c.category}</Text>
              <Text style={styles.catAmount}>{inr(c.total)}</Text>
            </View>
            <View style={styles.catTrack}>
              <View style={[styles.catFill, { width: max > 0 ? `${(c.total / max) * 100}%` : '0%' }]} />
            </View>
          </View>
        ))
      )}
      <View style={{ height: spacing['3xl'] }} />
    </ScrollView>
  );
}

// ── Account balances ─────────────────────────────────────────────────────────

function BalancesTab() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['report-balances'],
    queryFn: reportsApi.accountBalances,
  });

  if (isLoading) return <LoadingState message="Loading balances…" />;

  const accounts = data ?? [];
  const total = accounts.reduce((s, a) => s + (a.currentBalance ?? 0), 0);

  return (
    <FlatList
      data={accounts}
      keyExtractor={(a) => a.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      ListHeaderComponent={<Banner label="Total Across Accounts" value={inr(total)} sub={`${accounts.length} active account${accounts.length === 1 ? '' : 's'}`} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSub}>
              {item.accountType?.replace(/_/g, ' ')}{item.bankName ? ` · ${item.bankName}` : ''}
            </Text>
          </View>
          <Text style={[styles.rowAmount, { color: colors.primary }]}>{inr(item.currentBalance)}</Text>
        </View>
      )}
      ListEmptyComponent={<EmptyState icon="wallet-outline" title="No accounts" description="Create accounts in the web portal." />}
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const [tab, setTab] = useState<Tab>('Dues');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reports" showBack />

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Dues' && <DuesTab />}
      {tab === 'Collection' && <CollectionTab />}
      {tab === 'Expenses' && <ExpensesTab />}
      {tab === 'Balances' && <BalancesTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },

  list: { padding: spacing.base },

  banner: { borderRadius: radius.lg, padding: spacing.xl, gap: 3 },
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
  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  rowAmount: { ...typography.headingSmall, fontWeight: '700' },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  stepBtn: { padding: 4 },
  stepLabel: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },

  statGrid: { flexDirection: 'row', gap: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  statLabel: { ...typography.labelSmall, color: colors.textSecondary },
  statValue: { ...typography.headingSmall, marginTop: 4, fontWeight: '700' },

  catRow: { marginBottom: spacing.md, gap: 5 },
  catTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  catName: { ...typography.bodyMedium, color: colors.text, fontWeight: '500' },
  catAmount: { ...typography.labelLarge, color: colors.text, fontWeight: '700' },
  catTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden' },
  catFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
});
