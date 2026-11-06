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
import { societiesApi } from '@/api/endpoints/societies.api';
import { eventsApi } from '@/api/endpoints/events.api';
import { billingPeriodName } from '@/types/billing.types';
import { useAuth } from '@/hooks/useAuth';
import { HomeSkeleton } from '@/components/motion/Skeleton';
import { FadeInUp } from '@/components/motion/FadeInUp';
import { CountUp } from '@/components/motion/CountUp';
import { SectionHeader } from '@/components/ui/Card';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { BrandMark } from '@/components/ui/BrandMark';
import { HeroCard } from '@/components/home/HeroCard';
import { ProgressRing } from '@/components/home/ProgressRing';
import { TintStatTile } from '@/components/home/TintStatTile';
import { ActionGrid, ActionItem } from '@/components/home/ActionGrid';
import { UpdatesCarousel, UpdateItem } from '@/components/home/UpdatesCarousel';
import { useBranding } from '@/hooks/useBranding';
import { colors, spacing, typography, radius } from '@/theme';
import { fonts } from '@/theme/typography';
import { inr, inrCompact, toNum } from '@/utils/format';

/** Compact rupees; tolerates the API sending numbers, decimal strings or nothing. */
const formatCurrency = inrCompact;

const QUICK_ACTIONS: readonly ActionItem[] = [
  { label: 'Billing', icon: 'receipt-outline', tone: 'blue', route: '/(app)/admin/maintenance' },
  { label: 'Sheet', icon: 'grid-outline', tone: 'teal', route: '/(app)/maintenance-sheet' },
  { label: 'Verify', icon: 'checkmark-circle-outline', tone: 'green', route: '/(app)/admin/payments' },
  { label: 'Expense', icon: 'add-circle-outline', tone: 'coral', route: '/(app)/admin/expenses' },
  { label: 'Helpdesk', icon: 'construct-outline', tone: 'amber', route: '/(app)/admin/helpdesk' },
  { label: 'Announce', icon: 'megaphone-outline', tone: 'violet', route: '/(app)/admin/announcements' },
  { label: 'Amenities', icon: 'calendar-outline', tone: 'teal', route: '/(app)/admin/amenities' },
  { label: 'Gate Log', icon: 'walk-outline', tone: 'coral', route: '/(app)/admin/visitors' },
  { label: 'Directory', icon: 'people-outline', tone: 'blue', route: '/(app)/directory' },
  { label: 'Community', icon: 'chatbubbles-outline', tone: 'violet', route: '/(app)/forum' },
  { label: 'Messages', icon: 'chatbox-ellipses-outline', tone: 'green', route: '/(app)/chat' },
];

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

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

  // What is happening in the society, for the swipe strip. Each is optional: a request that fails just leaves its card out.
  const { data: announcements, refetch: refetchAnnouncements } = useQuery({
    queryKey: ['home-announcements'],
    queryFn: () => societiesApi.getAnnouncements({ limit: 3 }).catch(() => null),
    staleTime: 60_000,
  });
  const { data: meetings, refetch: refetchMeetings } = useQuery({
    queryKey: ['home-meetings'],
    queryFn: () => societiesApi.getMeetings({ limit: 10 }).catch(() => null),
    staleTime: 60_000,
  });
  const { data: events, refetch: refetchEvents } = useQuery({
    queryKey: ['home-events'],
    queryFn: () => eventsApi.list({ limit: 10 }).catch(() => null),
    staleTime: 60_000,
  });

  const refetch = () => {
    refetchSummary();
    refetchPeriod();
    refetchPeriods();
    refetchAnnouncements();
    refetchMeetings();
    refetchEvents();
  };

  if (isLoading || periodsLoading) return <HomeSkeleton message="Loading dashboard..." />;

  const billed = toNum(summary?.totalBilled);
  const collected = toNum(summary?.totalCollected);
  const collectedFraction = billed > 0 ? collected / billed : 0;
  const pending = summary?.pendingApprovals ?? 0;
  const banner = shownPeriod ?? currentPeriod;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const nextMeeting = (meetings?.data ?? [])
    .filter((m) => new Date(m.meetingDate) >= startOfToday)
    .sort((a, b) => +new Date(a.meetingDate) - +new Date(b.meetingDate))[0];
  const nextEvent = (events?.data ?? [])
    .filter((e) => e.status === 'PLANNED' && new Date(e.eventDate) >= startOfToday)
    .sort((a, b) => +new Date(a.eventDate) - +new Date(b.eventDate))[0];

  const updates: UpdateItem[] = [
    ...(pending > 0
      ? [{
          id: 'approvals',
          tone: 'amber' as const,
          icon: 'time-outline' as const,
          title: `${pending} payment${pending !== 1 ? 's' : ''} pending approval`,
          subtitle: 'Check the amount and approve it.',
          cta: 'Review now',
          onPress: () => router.push('/(app)/admin/payments'),
        }]
      : []),
    ...(announcements?.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      tone: 'violet' as const,
      icon: 'megaphone-outline' as const,
      title: a.title,
      subtitle: a.content,
      cta: 'Announcements',
      onPress: () => router.push('/(app)/admin/announcements' as any),
    })),
    ...(nextMeeting
      ? [{
          id: `m-${nextMeeting.id}`,
          tone: 'teal' as const,
          icon: 'calendar-outline' as const,
          title: nextMeeting.title,
          subtitle: `Meeting on ${when(nextMeeting.meetingDate)}${nextMeeting.location ? `, ${nextMeeting.location}` : ''}`,
          cta: 'Meetings',
          onPress: () => router.push('/(app)/admin/meetings' as any),
        }]
      : []),
    ...(nextEvent
      ? [{
          id: `e-${nextEvent.id}`,
          tone: 'coral' as const,
          icon: 'sparkles-outline' as const,
          title: nextEvent.title,
          subtitle: `Event on ${when(nextEvent.eventDate)}`,
          cta: 'Events',
          onPress: () => router.push('/(app)/admin/events' as any),
        }]
      : []),
  ];

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
        {/* Hero: the billing month in view, what is still to collect, and how much is in. Swipe it to change month. */}
        <FadeInUp>
        <View {...swipe.panHandlers}>
          {banner && (
            <HeroCard>
              <View style={styles.heroRow}>
                {periods.length > 1 && (
                  <TouchableOpacity
                    onPress={() => go('older')}
                    disabled={!canOlder}
                    hitSlop={10}
                    style={[styles.heroArrow, !canOlder && styles.heroArrowOff]}
                    accessibilityLabel="Earlier billing period"
                  >
                    <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLabel}>{index === 0 || !shownPeriod ? 'Current Billing Period' : 'Billing Period'}</Text>
                  <Text style={styles.heroPeriod}>{billingPeriodName(banner)}</Text>
                </View>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>{banner.status}</Text>
                </View>
                {periods.length > 1 && (
                  <TouchableOpacity
                    onPress={() => go('newer')}
                    disabled={!canNewer}
                    hitSlop={10}
                    style={[styles.heroArrow, !canNewer && styles.heroArrowOff]}
                    accessibilityLabel="Later billing period"
                  >
                    <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>

              <CountUp value={toNum(summary?.totalOutstanding)} format={inr} suffix=" pending" style={styles.heroAmount} />
              <Text style={styles.heroSub}>of {inr(summary?.totalBilled)} billed this month</Text>

              <View style={styles.heroBottom}>
                <ProgressRing
                  fraction={collectedFraction}
                  label={`${Math.round(collectedFraction * 100)}%`}
                  accessibilityLabel={`${Math.round(collectedFraction * 100)} percent collected`}
                />
                <View style={styles.heroMini}>
                  <View style={styles.heroMiniBox}>
                    <Text style={styles.heroMiniValue}>{formatCurrency(summary?.totalCollected)}</Text>
                    <Text style={styles.heroMiniLabel}>collected</Text>
                  </View>
                  <TouchableOpacity style={styles.heroMiniBox} activeOpacity={0.8} onPress={() => router.push('/(app)/admin/payments')}>
                    <Text style={styles.heroMiniValue}>{pending}</Text>
                    <Text style={styles.heroMiniLabel}>to review</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {periods.length > 1 && <Text style={styles.heroHint}>Swipe, or tap the arrows, to see other months</Text>}
            </HeroCard>
          )}
        </View>
        </FadeInUp>

        {/* What is happening: swipe sideways */}
        {updates.length > 0 && (
          <FadeInUp delay={90}>
            <SectionHeader title="What's Happening" />
            <UpdatesCarousel items={updates} />
          </FadeInUp>
        )}

        {/* Figures for the month in view — every tile drills into the report it summarizes */}
        <SectionHeader title={shownPeriod ? `Financial Overview — ${billingPeriodName(shownPeriod)}` : 'Financial Overview'} />
        <FadeInUp delay={180}>
        <View {...swipe.panHandlers}>
          <View style={styles.statsGrid}>
            <TintStatTile tone="blue" icon="receipt-outline" label="Total Billed" value={formatCurrency(summary?.totalBilled)} onPress={() => router.push('/(app)/admin/reports' as any)} />
            <TintStatTile tone="green" icon="trending-up-outline" label="Collected" value={formatCurrency(summary?.totalCollected)} progress={collectedFraction} onPress={() => router.push('/(app)/admin/reports' as any)} />
          </View>
          <View style={styles.statsGrid}>
            <TintStatTile tone="amber" icon="alert-circle-outline" label="Outstanding" value={formatCurrency(summary?.totalOutstanding)} subtitle="pending collection" onPress={() => router.push('/(app)/admin/reports' as any)} />
            <TintStatTile tone="coral" icon="wallet-outline" label="Expenses" value={formatCurrency(summary?.totalExpenses)} onPress={() => router.push('/(app)/admin/expenses' as any)} />
          </View>
          <View style={styles.statsGrid}>
            <TintStatTile tone="blue" icon="business-outline" label="Bank Balance" value={formatCurrency(summary?.accountBalance)} onPress={() => router.push('/(app)/admin/accounts' as any)} />
            <TintStatTile tone="violet" icon="diamond-outline" label="Corpus Fund" value={formatCurrency(summary?.corpusBalance)} onPress={() => router.push('/(app)/admin/accounts' as any)} />
          </View>
        </View>
        </FadeInUp>

        {/* Quick actions */}
        <FadeInUp delay={270}>
          <SectionHeader title="Quick Actions" />
          <ActionGrid items={QUICK_ACTIONS} onOpen={(route) => router.push(route as any)} />
        </FadeInUp>

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

  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroArrow: { padding: 6, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.16)' },
  heroArrowOff: { opacity: 0.3 },
  heroLabel: { ...typography.labelSmall, color: 'rgba(255,255,255,0.8)' },
  heroPeriod: { ...typography.headingSmall, color: '#FFFFFF', marginTop: 2 },
  heroPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.18)' },
  heroPillText: { ...typography.labelSmall, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.4 },
  heroAmount: { ...typography.displayLarge, color: '#FFFFFF', marginTop: spacing.sm },
  heroSub: { ...typography.bodySmall, color: 'rgba(255,255,255,0.85)' },
  heroBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.base, marginTop: spacing.md },
  heroMini: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  heroMiniBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  heroMiniValue: { ...typography.headingSmall, fontFamily: fonts.extrabold, color: '#FFFFFF' },
  heroMiniLabel: { ...typography.labelSmall, color: 'rgba(255,255,255,0.85)' },
  heroHint: { ...typography.bodySmall, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginTop: spacing.sm },

  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },

  bottomPad: { height: spacing['2xl'] },
});
