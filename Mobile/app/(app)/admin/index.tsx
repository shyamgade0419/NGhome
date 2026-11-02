import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  PanResponder,
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
import { NotificationBell } from '@/components/ui/NotificationBell';
import { BrandMark } from '@/components/ui/BrandMark';
import { useBranding } from '@/hooks/useBranding';
import { colors, spacing, typography, radius } from '@/theme';
import { inrCompact } from '@/utils/format';

/** Compact rupees; tolerates the API sending numbers, decimal strings or nothing. */
const formatCurrency = inrCompact;

const QUICK_ACTIONS = [
  { label: 'Manage Billing', icon: 'receipt-outline', route: '/(app)/admin/maintenance' },
  { label: 'Maintenance Sheet', icon: 'grid-outline', route: '/(app)/maintenance-sheet' },
  { label: 'Verify Payment', icon: 'checkmark-circle-outline', route: '/(app)/admin/payments' },
  { label: 'Add Expense', icon: 'add-circle-outline', route: '/(app)/admin/expenses' },
  { label: 'Helpdesk', icon: 'construct-outline', route: '/(app)/admin/helpdesk' },
  { label: 'Announce', icon: 'megaphone-outline', route: '/(app)/admin/announcements' },
  { label: 'Amenities', icon: 'calendar-outline', route: '/(app)/admin/amenities' },
  { label: 'Gate Log', icon: 'walk-outline', route: '/(app)/admin/visitors' },
  { label: 'Directory', icon: 'people-outline', route: '/(app)/directory' },
  { label: 'Community Board', icon: 'chatbubbles-outline', route: '/(app)/forum' },
  { label: 'Messages', icon: 'chatbox-ellipses-outline', route: '/(app)/chat' },
] as const;

export default function AdminDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const brand = useBranding();

  // The published billing periods, newest first: what the dashboard can show. It opens on the newest (the one in use)
  // and steps back through older ones by arrow or swipe.
  const { data: periodList, isLoading: periodsLoading, refetch: refetchPeriods } = useQuery({
    queryKey: ['admin-dashboard-periods'],
    queryFn: billingApi.listPublishedPeriods,
    staleTime: 60_000,
  });
  const periods = (periodList ?? []).filter((p) => p.kind !== 'OPENING');
  const [picked, setPicked] = useState<{ year: number; month: number } | null>(null);
  const now = new Date();
  const chosen = picked ?? (periods[0] ? { year: periods[0].periodYear, month: periods[0].periodMonth } : { year: now.getFullYear(), month: now.getMonth() + 1 });
  const index = periods.findIndex((p) => p.periodYear === chosen.year && p.periodMonth === chosen.month);
  const shownPeriod = index >= 0 ? periods[index] : null;
  const canOlder = index >= 0 && index < periods.length - 1;
  const canNewer = index > 0;
  const go = (dir: 'older' | 'newer') => {
    const next = periods[dir === 'older' ? index + 1 : index - 1];
    if (next) setPicked({ year: next.periodYear, month: next.periodMonth });
  };
  // Swiping right brings the earlier month into view, left the later one, like turning pages.
  const goRef = useRef(go);
  goRef.current = go;
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 50) goRef.current('older');
        else if (g.dx < -50) goRef.current('newer');
      },
    }),
  ).current;

  const { data: summary, isLoading, refetch: refetchSummary, isRefetching } = useQuery({
    queryKey: ['admin-dashboard', chosen.year, chosen.month],
    queryFn: () => billingApi.getDashboardSummary(chosen),
    staleTime: 60_000,
    // Not before the periods are known, or the first figures would be for the wrong month.
    enabled: !periodsLoading,
    // While another month loads, keep the one on screen rather than blanking the whole dashboard to a spinner.
    placeholderData: (previous) => previous,
  });

  const { data: currentPeriod, refetch: refetchPeriod } = useQuery({
    queryKey: ['current-period'],
    queryFn: billingApi.getCurrentPeriod,
    staleTime: 60_000,
  });

  const refetch = () => { refetchSummary(); refetchPeriod(); refetchPeriods(); };

  if (isLoading || periodsLoading) return <LoadingState fullscreen message="Loading dashboard..." />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <BrandMark />
          <Text style={styles.greeting}>
            Good {getTimeOfDay()}, {user?.firstName}
          </Text>
          <Text style={styles.societyName} numberOfLines={1}>
            {currentPeriod ? billingPeriodName(currentPeriod) : 'Admin Panel'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <NotificationBell onPress={() => router.push('/(app)/notifications' as any)} />
          <TouchableOpacity onPress={() => router.push('/(app)/admin/settings' as any)} hitSlop={8}>
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/admin/profile' as any)} hitSlop={8}>
            <View style={[styles.avatarCircle, { backgroundColor: brand.tint }]}>
              <Text style={[styles.avatarText, { color: brand.onTint }]}>
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
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={brand.color} />
        }
      >
        {/* Current period banner — tinted rather than another plain white
            card so it reads as the "headline" card of the dashboard. */}
        <View {...swipe.panHandlers}>
        {(shownPeriod ?? currentPeriod) && (
          <Card style={[styles.periodBanner, { backgroundColor: brand.tint, borderColor: brand.tint }]} padding="md">
            <View style={styles.periodRow}>
              {periods.length > 1 && (
                <TouchableOpacity
                  onPress={() => go('older')}
                  disabled={!canOlder}
                  hitSlop={10}
                  style={[styles.periodArrow, !canOlder && styles.periodArrowOff]}
                  accessibilityLabel="Earlier billing period"
                >
                  <Ionicons name="chevron-back" size={20} color={colors.text} />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.periodLabel}>{index === 0 || !shownPeriod ? 'Current Billing Period' : 'Billing Period'}</Text>
                <Text style={styles.periodName}>{billingPeriodName((shownPeriod ?? currentPeriod) as NonNullable<typeof currentPeriod>)}</Text>
              </View>
              <StatusBadge
                label={(shownPeriod ?? currentPeriod)!.status}
                variant={billingStatusVariant((shownPeriod ?? currentPeriod)!.status)}
              />
              {periods.length > 1 && (
                <TouchableOpacity
                  onPress={() => go('newer')}
                  disabled={!canNewer}
                  hitSlop={10}
                  style={[styles.periodArrow, !canNewer && styles.periodArrowOff]}
                  accessibilityLabel="Later billing period"
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.text} />
                </TouchableOpacity>
              )}
            </View>
            {periods.length > 1 && <Text style={styles.periodHint}>Swipe, or tap the arrows, to see other months</Text>}
          </Card>
        )}

        {/* Stats grid — every tile drills into the report it summarizes */}
        <SectionHeader title={shownPeriod ? `Financial Overview — ${billingPeriodName(shownPeriod)}` : 'Financial Overview'} />
        <View style={styles.statsGrid}>
          <StatCard
            label="Total Billed"
            value={formatCurrency(summary?.totalBilled)}
            color={colors.primary}
            onPress={() => router.push('/(app)/admin/reports' as any)}
          />
          <StatCard
            label="Collected"
            value={formatCurrency(summary?.totalCollected)}
            color={colors.secondary}
            onPress={() => router.push('/(app)/admin/reports' as any)}
          />
        </View>
        <View style={styles.statsGrid}>
          <StatCard
            label="Outstanding"
            value={formatCurrency(summary?.totalOutstanding)}
            color={colors.warning}
            subtitle="pending collection"
            onPress={() => router.push('/(app)/admin/reports' as any)}
          />
          <StatCard
            label="Expenses"
            value={formatCurrency(summary?.totalExpenses)}
            color={colors.error}
            onPress={() => router.push('/(app)/admin/expenses' as any)}
          />
        </View>
        <View style={styles.statsGrid}>
          <StatCard
            label="Bank Balance"
            value={formatCurrency(summary?.accountBalance)}
            color={colors.info}
            onPress={() => router.push('/(app)/admin/accounts' as any)}
          />
          <StatCard
            label="Corpus Fund"
            value={formatCurrency(summary?.corpusBalance)}
            color="#7C3AED"
            onPress={() => router.push('/(app)/admin/accounts' as any)}
          />
        </View>
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
              <Text style={styles.actionLabel} numberOfLines={2}>{action.label}</Text>
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

  periodArrow: { padding: 6, borderRadius: radius.md, marginHorizontal: spacing.xs },
  periodArrowOff: { opacity: 0.3 },
  periodHint: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
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
