/**
 * Admin — Salaries
 *
 * Staff roster and monthly salary records. Marking a record paid is available
 * here because it is a one-tap confirmation; processing a new salary run stays
 * on the web, where the additions/deductions breakdown has room to be entered
 * carefully. Payroll mistakes are expensive, so mobile deliberately exposes
 * the review-and-confirm half only.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salariesApi, Employee, SalaryRecord } from '@/api/endpoints/salaries.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inr(v: string | number | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function statusVariant(s: string): 'success' | 'warning' | 'info' | 'neutral' {
  if (s === 'PAID') return 'success';
  if (s === 'PROCESSED') return 'info';
  if (s === 'DRAFT') return 'warning';
  return 'neutral';
}

// ── Employees tab ────────────────────────────────────────────────────────────

function EmployeesTab() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['employees'],
    queryFn: salariesApi.listEmployees,
  });

  if (isLoading) return <LoadingState message="Loading staff…" />;
  if (isError) {
    return <EmptyState icon="alert-circle-outline" title="Couldn't load staff" description="Pull down to retry." />;
  }

  const staff = (data ?? []).filter((e) => e.isActive);
  const payroll = staff.reduce((s, e) => s + parseFloat(e.baseSalary ?? '0'), 0);

  return (
    <FlatList
      data={staff}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      ListHeaderComponent={
        staff.length > 0 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerLabel}>Monthly Payroll</Text>
            <Text style={styles.bannerValue}>{inr(payroll)}</Text>
            <Text style={styles.bannerSub}>{staff.length} active staff</Text>
          </View>
        ) : null
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }: { item: Employee }) => (
        <View style={styles.row}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.name.split(' ').map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowMeta}>
              {item.designation}
              {item.employeeCode ? ` · ${item.employeeCode}` : ''}
            </Text>
            {item.phone ? <Text style={styles.rowMeta}>{item.phone}</Text> : null}
          </View>
          <Text style={[styles.rowAmount, { color: colors.primary }]}>{inr(item.baseSalary)}</Text>
        </View>
      )}
      ListEmptyComponent={
        <EmptyState icon="people-outline" title="No staff" description="Add staff in the web portal to run payroll." />
      }
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

// ── Records tab ──────────────────────────────────────────────────────────────

function RecordsTab() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['salary-records', year, month],
    queryFn: () => salariesApi.listRecords({ month, year }),
  });

  const payMutation = useMutation({
    mutationFn: (id: string) => salariesApi.pay(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-records'] });
      Alert.alert('Marked Paid', 'Salary recorded as paid.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to mark paid.'),
  });

  const step = (dir: -1 | 1) => {
    let m = month + dir;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m); setYear(y);
  };

  const records = data?.data ?? [];
  const total = records.reduce((s, r) => s + parseFloat(r.netSalary ?? '0'), 0);

  return (
    <FlatList
      data={records}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      ListHeaderComponent={
        <>
          <View style={styles.stepper}>
            <TouchableOpacity onPress={() => step(-1)} hitSlop={8} style={styles.stepBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.stepLabel}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => step(1)} hitSlop={8} style={styles.stepBtn}>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {records.length > 0 && (
            <View style={[styles.banner, { marginBottom: spacing.md }]}>
              <Text style={styles.bannerLabel}>Net Payable</Text>
              <Text style={styles.bannerValue}>{inr(total)}</Text>
              <Text style={styles.bannerSub}>{records.length} record{records.length === 1 ? '' : 's'}</Text>
            </View>
          )}
        </>
      }
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      renderItem={({ item }: { item: SalaryRecord }) => (
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.employee?.name ?? 'Staff member'}</Text>
              {item.employee?.designation ? (
                <Text style={styles.rowMeta}>{item.employee.designation}</Text>
              ) : null}
            </View>
            <StatusBadge label={item.status} variant={statusVariant(item.status)} size="sm" />
          </View>

          <View style={styles.amountRow}>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Base</Text>
              <Text style={styles.amountValue}>{inr(item.baseSalary)}</Text>
            </View>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Additions</Text>
              <Text style={[styles.amountValue, { color: colors.success }]}>{inr(item.additions)}</Text>
            </View>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Deductions</Text>
              <Text style={[styles.amountValue, { color: colors.error }]}>{inr(item.deductions)}</Text>
            </View>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Net</Text>
              <Text style={[styles.amountValue, { color: colors.primary, fontWeight: '700' }]}>{inr(item.netSalary)}</Text>
            </View>
          </View>

          {item.status === 'PROCESSED' && (
            <TouchableOpacity
              style={styles.payBtn}
              onPress={() =>
                Alert.alert(
                  'Mark as Paid',
                  `Record ${inr(item.netSalary)} as paid to ${item.employee?.name ?? 'this employee'}?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Mark Paid', onPress: () => payMutation.mutate(item.id) },
                  ],
                )
              }
              disabled={payMutation.isPending}
            >
              <Ionicons name="checkmark-circle-outline" size={15} color={colors.success} />
              <Text style={styles.payBtnText}>Mark as Paid</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={
        isLoading ? (
          <LoadingState message="Loading records…" />
        ) : (
          <EmptyState
            icon="cash-outline"
            title="No salary records"
            description={`Nothing processed for ${MONTHS[month]} ${year}. Run payroll from the web portal.`}
          />
        )
      }
      ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
    />
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function SalariesScreen() {
  const [tab, setTab] = useState<'Staff' | 'Records'>('Records');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Salaries" showBack />
      <View style={styles.tabBar}>
        {(['Records', 'Staff'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Records' ? <RecordsTab /> : <EmployeesTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

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

  banner: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.xl, gap: 3 },
  bannerLabel: { ...typography.labelMedium, color: 'rgba(255,255,255,0.8)' },
  bannerValue: { ...typography.displaySmall, color: '#fff', fontWeight: '700' },
  bannerSub: { ...typography.bodySmall, color: 'rgba(255,255,255,0.75)' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.base,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { ...typography.labelMedium, color: colors.primary, fontWeight: '700' },
  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  rowAmount: { ...typography.labelLarge, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  amountRow: { flexDirection: 'row', gap: spacing.sm },
  amountItem: { flex: 1 },
  amountLabel: { ...typography.labelSmall, color: colors.textSecondary, fontSize: 10 },
  amountValue: { ...typography.bodyMedium, color: colors.text, marginTop: 2, fontWeight: '600' },

  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.success,
  },
  payBtnText: { ...typography.labelMedium, color: colors.success, fontWeight: '600' },

  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  stepBtn: { padding: 4 },
  stepLabel: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
});
