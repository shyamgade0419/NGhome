/**
 * Resident — Reports
 *
 * Three views, each shown only when it can be:
 *  - My statement: the resident's own bills, what they have paid and what is pending. Always there; it is only theirs.
 *  - Collection: how much the society billed, collected and is owed in a month, and how many flats have paid. Shown when
 *    the admin switches it on (Settings → Resident Visibility). Never names a flat or a person.
 *  - Expenses: where the society's money went in a month, by category, with staff pay as one line. Shown when the admin
 *    shows expenses to residents.
 * The server decides what is on: a switched-off report answers `enabled: false`, and the screen does not offer its tab.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SummaryStrip } from '@/components/home/SummaryStrip';
import { ProgressRing } from '@/components/home/ProgressRing';
import { FadeInUp } from '@/components/motion/FadeInUp';
import { colors, spacing, typography, radius } from '@/theme';
import { HERO_GRADIENT, tint, tones } from '@/theme/tones';
import { fonts } from '@/theme/typography';
import { inr } from '@/utils/format';
import {
  currentMonth,
  isAfter,
  monthTitle,
  shiftMonth,
  statementRows,
  statementText,
  statementTotals,
  type YearMonth,
} from '@/reports/residentReports';

type Tab = 'statement' | 'collection' | 'expenses';

export default function ResidentReportsScreen() {
  const now = useMemo(() => currentMonth(), []);
  const [month, setMonth] = useState<YearMonth>(now);
  const [tab, setTab] = useState<Tab>('statement');

  // What is switched on is learned from this month's answers; stepping to another month asks again but never changes it.
  const collection = useQuery({
    queryKey: ['resident-report-collection', month.year, month.month],
    queryFn: () => societiesApi.getCollectionReport(month.year, month.month),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const expenses = useQuery({
    queryKey: ['resident-report-expenses', month.year, month.month],
    queryFn: () => societiesApi.getExpenseReport(month.year, month.month),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const bills = useQuery({
    queryKey: ['resident-statement'],
    queryFn: () => billingApi.getMyBills({ page: 1, limit: 100 }),
  });

  const collectionOn = collection.data?.enabled === true;
  const expensesOn = expenses.data?.enabled === true;
  const tabs: { key: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'statement', label: 'My statement', icon: 'document-text-outline' },
    ...(collectionOn ? [{ key: 'collection' as const, label: 'Collection', icon: 'trending-up-outline' as const }] : []),
    ...(expensesOn ? [{ key: 'expenses' as const, label: 'Expenses', icon: 'wallet-outline' as const }] : []),
  ];
  // If the tab being looked at is switched off while the screen is open, fall back to the one that is always there.
  const active: Tab = tabs.some((t) => t.key === tab) ? tab : 'statement';

  const refreshing = bills.isRefetching || collection.isRefetching || expenses.isRefetching;
  const refetchAll = () => { void bills.refetch(); void collection.refetch(); void expenses.refetch(); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reports" showBack />
      {tabs.length > 1 && (
        <View style={styles.tabs}>
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={t.icon} size={16} color={on ? colors.primary : colors.textSecondary} />
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.primary} />}
      >
        {active === 'statement' && <StatementView query={bills} />}
        {active === 'collection' && (
          <>
            <MonthStepper month={month} now={now} onChange={setMonth} />
            <CollectionView query={collection} />
          </>
        )}
        {active === 'expenses' && (
          <>
            <MonthStepper month={month} now={now} onChange={setMonth} />
            <ExpensesView query={expenses} />
          </>
        )}
        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Month stepper ────────────────────────────────────────────────────────────

function MonthStepper({ month, now, onChange }: { month: YearMonth; now: YearMonth; onChange: (m: YearMonth) => void }) {
  const atLatest = !isAfter(shiftMonth(month, 1), now);
  return (
    <View style={styles.stepper}>
      <TouchableOpacity onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.stepBtn}>
        <Ionicons name="chevron-back" size={20} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.stepTitle}>{monthTitle(month)}</Text>
      <TouchableOpacity
        onPress={() => atLatest && onChange(shiftMonth(month, 1))}
        disabled={!atLatest}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !atLatest }}
        style={[styles.stepBtn, !atLatest && { opacity: 0.35 }]}
      >
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

// ── Hero card ────────────────────────────────────────────────────────────────

function Hero({ eyebrow, big, foot, ring }: { eyebrow: string; big: string; foot: string; ring?: { fraction: number; label: string } }) {
  return (
    <LinearGradient colors={[...HERO_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>{big}</Text>
        <Text style={styles.foot}>{foot}</Text>
      </View>
      {ring && <ProgressRing fraction={ring.fraction} label={ring.label} size={68} accessibilityLabel={`${ring.label} collected`} />}
    </LinearGradient>
  );
}

// ── My statement ─────────────────────────────────────────────────────────────

function StatementView({ query }: { query: UseQueryResult<Awaited<ReturnType<typeof billingApi.getMyBills>>> }) {
  const rows = useMemo(() => statementRows(query.data?.data ?? []), [query.data]);
  const totals = useMemo(() => statementTotals(rows), [rows]);
  const flat = query.data?.data?.[0]?.flatCode;

  if (query.isLoading) return <LoadingState message="Loading your statement…" />;
  if (query.isError) return <EmptyState icon="alert-circle-outline" title="Couldn't load your statement" description="Pull down to try again." />;
  if (rows.length === 0) return <EmptyState icon="document-text-outline" title="No bills yet" description="Your bills will appear here once your society publishes them." />;

  return (
    <FadeInUp>
      <Hero
        eyebrow="STILL TO PAY"
        big={inr(totals.pending)}
        foot={`${inr(totals.paid)} paid of ${inr(totals.billed)} billed`}
        ring={totals.billed > 0 ? { fraction: totals.paid / totals.billed, label: `${Math.round((totals.paid / totals.billed) * 100)}%` } : undefined}
      />
      <SummaryStrip
        tiles={[
          { key: 'b', tone: 'blue', icon: 'receipt-outline', label: 'Billed', value: inr(totals.billed) },
          { key: 'p', tone: 'green', icon: 'checkmark-circle-outline', label: 'Paid', value: inr(totals.paid) },
          { key: 'd', tone: 'amber', icon: 'time-outline', label: 'Pending', value: inr(totals.pending) },
        ]}
      />
      <View style={styles.list}>
        {rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.title}</Text>
              <Text style={styles.rowSub}>{r.invoiceNumber}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={styles.rowAmount}>{inr(r.total)}</Text>
              <StatusBadge
                size="sm"
                label={r.state === 'PAID' ? 'Paid' : r.state === 'PART' ? `${inr(r.pending)} due` : 'Due'}
                variant={r.state === 'PAID' ? 'success' : r.state === 'PART' ? 'warning' : 'error'}
              />
            </View>
          </View>
        ))}
      </View>
      <TouchableOpacity
        style={styles.shareBtn}
        onPress={() => void Share.share({ message: statementText(rows, flat) })}
        accessibilityRole="button"
        accessibilityLabel="Share my statement"
      >
        <Ionicons name="share-outline" size={18} color={colors.primary} />
        <Text style={styles.shareText}>Share my statement</Text>
      </TouchableOpacity>
    </FadeInUp>
  );
}

// ── Collection ───────────────────────────────────────────────────────────────

function CollectionView({ query }: { query: UseQueryResult<Awaited<ReturnType<typeof societiesApi.getCollectionReport>>> }) {
  const d = query.data;
  if (query.isLoading && !d) return <LoadingState message="Loading…" />;
  if (query.isError) return <EmptyState icon="alert-circle-outline" title="Couldn't load this report" description="Pull down to try again." />;
  if (!d?.found) return <EmptyState icon="calendar-outline" title="No figures for this month" description="Collection figures appear once the month's bills have been published." />;

  const billed = d.totalBilled ?? 0;
  const collected = d.totalCollected ?? 0;
  const rate = d.collectionRate ?? 0;
  return (
    <FadeInUp>
      <Hero
        eyebrow="COLLECTED"
        big={inr(collected)}
        foot={`of ${inr(billed)} billed`}
        ring={{ fraction: rate / 100, label: `${Math.round(rate)}%` }}
      />
      <SummaryStrip
        tiles={[
          { key: 'b', tone: 'blue', icon: 'receipt-outline', label: 'Billed', value: inr(billed) },
          { key: 'c', tone: 'green', icon: 'trending-up-outline', label: 'Collected', value: inr(collected) },
          { key: 'p', tone: 'amber', icon: 'time-outline', label: 'Pending', value: inr(d.totalPending ?? 0) },
        ]}
      />
      {(d.flatsBilled ?? 0) > 0 && (
        <View style={styles.note}>
          <Ionicons name="home-outline" size={18} color={tones.teal} />
          <Text style={styles.noteText}>
            {d.flatsPaid ?? 0} of {d.flatsBilled} flats have paid in full
          </Text>
        </View>
      )}
    </FadeInUp>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

function ExpensesView({ query }: { query: UseQueryResult<Awaited<ReturnType<typeof societiesApi.getExpenseReport>>> }) {
  const d = query.data;
  if (query.isLoading && !d) return <LoadingState message="Loading…" />;
  if (query.isError) return <EmptyState icon="alert-circle-outline" title="Couldn't load this report" description="Pull down to try again." />;
  const cats = d?.byCategory ?? [];
  if (cats.length === 0) return <EmptyState icon="wallet-outline" title="No expenses this month" description="Approved and paid expenses appear here." />;

  const max = Math.max(...cats.map((c) => c.total));
  return (
    <FadeInUp>
      <Hero eyebrow="SPENT" big={inr(d?.total ?? 0)} foot="Approved and paid expenses, and staff pay" />
      <View style={styles.cats}>
        {cats.map((c) => (
          <View key={c.category} style={styles.cat}>
            <View style={styles.catTop}>
              <Text style={styles.catName} numberOfLines={1}>{c.category}</Text>
              <Text style={styles.catAmount}>{inr(c.total)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: max > 0 ? `${(c.total / max) * 100}%` : '0%' }, c.category === 'Staff Salaries' && { backgroundColor: tones.teal }]} />
            </View>
          </View>
        ))}
      </View>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingTop: spacing.md, flexGrow: 0, flexShrink: 0 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tabOn: { backgroundColor: tint(tones.teal, 0.88), borderColor: tint(tones.teal, 0.55) },
  tabText: { ...typography.labelMedium, color: colors.textSecondary, textTransform: 'none', letterSpacing: 0 },
  tabTextOn: { color: colors.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { ...typography.headingSmall, color: colors.text },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.xl, padding: spacing.lg, overflow: 'hidden', marginBottom: spacing.xs },
  eyebrow: { ...typography.labelSmall, color: 'rgba(255,255,255,0.75)' },
  big: { fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 42, color: '#FFFFFF' },
  foot: { ...typography.bodySmall, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  list: { gap: spacing.sm, paddingTop: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  rowTitle: { ...typography.bodyMedium, color: colors.text, fontFamily: fonts.semibold },
  rowSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  rowAmount: { ...typography.bodyMedium, color: colors.text, fontFamily: fonts.bold },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.base,
    paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary,
  },
  shareText: { ...typography.labelMedium, color: colors.primary, textTransform: 'none', letterSpacing: 0 },
  note: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md,
    backgroundColor: tint(tones.teal, 0.9), borderRadius: radius.lg, borderWidth: 1, borderColor: tint(tones.teal, 0.7),
  },
  noteText: { ...typography.bodyMedium, color: colors.text, flexShrink: 1 },
  cats: { gap: spacing.md, paddingTop: spacing.md },
  cat: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  catTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  catName: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  catAmount: { ...typography.bodyMedium, color: colors.text, fontFamily: fonts.bold },
  track: { height: 6, borderRadius: 3, backgroundColor: tint(tones.coral, 0.82), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: tones.coral },
});
