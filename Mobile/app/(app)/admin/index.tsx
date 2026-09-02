import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/endpoints/billing.api';
import { billingPeriodName } from '@/types/billing.types';
import { useAuth } from '@/hooks/useAuth';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card, StatCard, SectionHeader } from '@/components/ui/Card';
import { StatusBadge, billingStatusVariant } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { inrCompact } from '@/utils/format';

/** Compact rupees; tolerates the API sending numbers, decimal strings or nothing. */
const formatCurrency = inrCompact;

const QUICK_ACTIONS = [
  { label: 'Manage Billing', icon: 'receipt-outline', route: '/(app)/admin/maintenance' },
  { label: 'Verify Payment', icon: 'checkmark-circle-outline', route: '/(app)/admin/payments' },
  { label: 'Add Expense', icon: 'add-circle-outline', route: '/(app)/admin/expenses' },
  { label: 'Helpdesk', icon: 'construct-outline', route: '/(app)/admin/helpdesk' },
  { label: 'Announce', icon: 'megaphone-outline', route: '/(app)/admin/announcements' },
] as const;

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  const { data: summary, isLoading, refetch: refetchSummary, isRefetching } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: billingApi.getDashboardSummary,
    staleTime: 60_000,
  });

  const { data: currentPeriod, refetch: refetchPeriod } = useQuery({
    queryKey: ['current-period'],
    queryFn: billingApi.getCurrentPeriod,
    staleTime: 60_000,
  });

  const refetch = () => { refetchSummary(); refetchPeriod(); };

  if (isLoading) return <LoadingState fullscreen message="Loading dashboard..." />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>
            Good {getTimeOfDay()}, {user?.firstName}
          </Text>
          <Text style={styles.societyName} numberOfLines={1}>
            {currentPeriod ? billingPeriodName(currentPeriod) : 'Admin Panel'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push('/(app)/notifications' as any)} hitSlop={8}>
            <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/admin/settings' as any)} hitSlop={8}>
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/admin/profile' as any)} hitSlop={8}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {user?.firstName?.[0]}
                {user?.lastName?.[0]}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {/* Current period banner */}
        {currentPeriod && (
          <Card style={styles.periodBanner} padding="md">
            <View style={styles.periodRow}>
              <View>
                <Text style={styles.periodLabel}>Current Billing Period</Text>
                <Text style={styles.periodName}>{billingPeriodName(currentPeriod)}</Text>
              </View>
              <StatusBadge
                label={currentPeriod.status}
                variant={billingStatusVariant(currentPeriod.status)}
              />
            </View>
          </Card>
        )}

        {/* Stats grid */}
        <SectionHeader title="Financial Overview" />
        <View style={styles.statsGrid}>
          <StatCard
            label="Total Billed"
            value={formatCurrency(summary?.totalBilled)}
            color={colors.primary}
          />
          <StatCard
            label="Collected"
            value={formatCurrency(summary?.totalCollected)}
            color={colors.secondary}
          />
        </View>
        <View style={styles.statsGrid}>
          <StatCard
            label="Outstanding"
            value={formatCurrency(summary?.totalOutstanding)}
            color={colors.warning}
            subtitle="pending collection"
          />
          <StatCard
            label="Expenses"
            value={formatCurrency(summary?.totalExpenses)}
            color={colors.error}
          />
        </View>
        <View style={styles.statsGrid}>
          <StatCard
            label="Bank Balance"
            value={formatCurrency(summary?.accountBalance)}
            color={colors.info}
          />
          <StatCard
            label="Corpus Fund"
            value={formatCurrency(summary?.corpusBalance)}
            color="#7C3AED"
          />
        </View>

        {/* Pending approvals */}
        {(summary?.pendingApprovals ?? 0) > 0 && (
          <TouchableOpacity
            onPress={() => router.push('/(app)/admin/payments')}
            style={styles.alertBanner}
          >
            <View style={styles.alertIconWrap}>
              <Ionicons name="time" size={20} color={colors.warning} />
            </View>
            <View style={styles.alertText}>
              <Text style={styles.alertTitle}>
                {summary?.pendingApprovals} payment{summary?.pendingApprovals !== 1 ? 's' : ''} pending approval
              </Text>
              <Text style={styles.alertSub}>Tap to review and verify</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* Quick actions */}
        <SectionHeader title="Quick Actions" />
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.label}
              style={styles.actionCard}
              onPress={() => router.push(action.route as any)}
              activeOpacity={0.8}
            >
              <View style={styles.actionIcon}>
                <Ionicons name={action.icon} size={24} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  greeting: { ...typography.bodySmall, color: colors.textSecondary },
  societyName: { ...typography.headingSmall, color: colors.text, maxWidth: 240 },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.labelMedium, color: colors.primary, fontWeight: '700' },

  periodBanner: {
    margin: spacing.base,
    marginBottom: 0,
    gap: spacing.xs,
  },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodLabel: { ...typography.labelSmall, color: colors.textSecondary },
  periodName: { ...typography.headingSmall, color: colors.text, marginTop: 2 },
  dueDate: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.xs },

  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },

  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningLight,
    marginHorizontal: spacing.base,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertText: { flex: 1 },
  alertTitle: { ...typography.labelLarge, color: '#92400E' },
  alertSub: { ...typography.bodySmall, color: '#B45309', marginTop: 2 },

  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.base,
    gap: spacing.md,
  },
  actionCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { ...typography.labelLarge, color: colors.text },

  bottomPad: { height: spacing['2xl'] },
});
