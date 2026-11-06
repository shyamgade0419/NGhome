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
import { societiesApi } from '@/api/endpoints/societies.api';
import { eventsApi } from '@/api/endpoints/events.api';
import { useAuth } from '@/hooks/useAuth';
import { HomeSkeleton } from '@/components/motion/Skeleton';
import { FadeInUp } from '@/components/motion/FadeInUp';
import { CountUp } from '@/components/motion/CountUp';
import { SectionHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { BrandMark } from '@/components/ui/BrandMark';
import { PendingVisitorBanner } from '@/components/visitors/PendingVisitorBanner';
import { HeroCard } from '@/components/home/HeroCard';
import { ProgressRing } from '@/components/home/ProgressRing';
import { TintStatTile } from '@/components/home/TintStatTile';
import { ActionGrid, ActionItem } from '@/components/home/ActionGrid';
import { UpdatesCarousel, UpdateItem } from '@/components/home/UpdatesCarousel';
import { useBranding } from '@/hooks/useBranding';
import { useFeatures } from '@/hooks/useFeatures';
import { colors, spacing, typography, radius } from '@/theme';
import { toNum, inr } from '@/utils/format';

const QUICK_LINKS: readonly ActionItem[] = [
  { label: 'Maint. Sheet', icon: 'grid-outline', tone: 'teal', route: '/(app)/maintenance-sheet' },
  { label: 'Docs', icon: 'folder-open-outline', tone: 'blue', route: '/(app)/documents' },
  { label: 'Finances', icon: 'pie-chart-outline', tone: 'green', route: '/(app)/resident/finances' },
  { label: 'Events', icon: 'sparkles-outline', tone: 'coral', route: '/(app)/resident/events' },
  { label: 'Directory', icon: 'people-outline', tone: 'blue', route: '/(app)/directory' },
  { label: 'Community', icon: 'chatbubbles-outline', tone: 'violet', route: '/(app)/forum' },
  { label: 'Messages', icon: 'chatbox-ellipses-outline', tone: 'green', route: '/(app)/chat' },
  { label: 'Amenities', icon: 'calendar-outline', tone: 'teal', route: '/(app)/amenities' },
  { label: 'Visitors', icon: 'walk-outline', tone: 'coral', route: '/(app)/visitors' },
  { label: 'Deliveries', icon: 'cube-outline', tone: 'amber', route: '/(app)/deliveries' },
  { label: 'Household Help', icon: 'people-circle-outline', tone: 'green', route: '/(app)/household-help' },
  { label: 'Vehicles', icon: 'car-outline', tone: 'blue', route: '/(app)/vehicles' },
];

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

export default function ResidentDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const brand = useBranding();
  const { isOn, routeOn } = useFeatures();

  const { data: myBill, isLoading, refetch: refetchBill, isRefetching } = useQuery({
    queryKey: ['my-current-bill'],
    queryFn: billingApi.getMyCurrentBill,
  });

  // Only worth fetching when there's no current published bill to show —
  // once one exists, the preview (last period, already superseded) is noise.
  const { data: preview, refetch: refetchPreview } = useQuery({
    queryKey: ['my-bill-preview'],
    queryFn: billingApi.previewMyBill,
    enabled: !isLoading && !myBill,
  });

  const { data: announcements, refetch: refetchAnnouncements } = useQuery({
    queryKey: ['announcements-preview'],
    queryFn: () => societiesApi.getAnnouncements({ limit: 3 }),
  });
  // Optional extras for the swipe strip: a request that fails just leaves its card out.
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

  const onRefresh = () => {
    refetchBill();
    refetchAnnouncements();
    refetchPreview();
    refetchMeetings();
    refetchEvents();
  };

  if (isLoading) return <HomeSkeleton message="Loading your account..." />;

  const outstanding = myBill ? toNum(myBill.pendingAmount) : 0;
  const total = myBill ? toNum(myBill.totalAmount) : 0;
  const paid = myBill ? toNum(myBill.paidAmount) : 0;
  const paidFraction = total > 0 ? paid / total : 0;
  const isPaid = myBill?.isPaid ?? false;

  const periodLabel = myBill?.billingPeriod?.kind === 'OPENING'
    ? 'Opening balance (earlier dues)'
    : myBill
    ? `${new Date(myBill.dueDate).toLocaleString('en-IN', { month: 'short', year: 'numeric' })} Maintenance`
    : preview
      ? `${new Date(preview.dueDate).toLocaleString('en-IN', { month: 'short', year: 'numeric' })} Maintenance (Upcoming)`
      : 'Current Maintenance';

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const nextMeeting = !isOn('meetings') ? undefined : (meetings?.data ?? [])
    .filter((m) => new Date(m.meetingDate) >= startOfToday)
    .sort((a, b) => +new Date(a.meetingDate) - +new Date(b.meetingDate))[0];
  const nextEvent = !isOn('events') ? undefined : (events?.data ?? [])
    .filter((e) => e.status === 'PLANNED' && new Date(e.eventDate) >= startOfToday)
    .sort((a, b) => +new Date(a.eventDate) - +new Date(b.eventDate))[0];

  const real: UpdateItem[] = [
    ...(myBill && !isPaid
      ? [{
          id: 'bill',
          tone: 'amber' as const,
          icon: 'wallet-outline' as const,
          title: `${periodLabel} is due`,
          subtitle: `₹${outstanding.toLocaleString('en-IN')} by ${myBill.dueDate ? new Date(myBill.dueDate).toLocaleDateString('en-IN') : 'soon'}`,
          cta: "I've made payment",
          onPress: () => router.push('/(app)/resident/payments/submit'),
        }]
      : []),
    ...(announcements?.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      tone: a.priority === 'URGENT' || a.priority === 'HIGH' ? ('coral' as const) : ('violet' as const),
      icon: 'megaphone-outline' as const,
      title: a.title,
      subtitle: a.content,
      cta: 'Announcements',
      onPress: () => router.push('/(app)/resident/announcements'),
    })),
    ...(nextMeeting
      ? [{
          id: `m-${nextMeeting.id}`,
          tone: 'teal' as const,
          icon: 'calendar-outline' as const,
          title: nextMeeting.title,
          subtitle: `Meeting on ${when(nextMeeting.meetingDate)}${nextMeeting.location ? `, ${nextMeeting.location}` : ''}`,
          cta: 'Meetings',
          onPress: () => router.push('/(app)/resident/meetings' as any),
        }]
      : []),
    ...(nextEvent
      ? [{
          id: `e-${nextEvent.id}`,
          tone: 'green' as const,
          icon: 'sparkles-outline' as const,
          title: nextEvent.title,
          subtitle: `Event on ${when(nextEvent.eventDate)}`,
          cta: 'Events',
          onPress: () => router.push('/(app)/resident/events' as any),
        }]
      : []),
  ];

  // Nothing posted yet: cards for what a resident can do, so the strip is always there.
  const tips: UpdateItem[] = [
    { id: 'tip-helpdesk', tone: 'amber' as const, icon: 'construct-outline' as const, title: 'Need something fixed?', subtitle: 'Raise a request and follow it until it is done.', cta: 'Open the helpdesk', onPress: () => router.push('/(app)/resident/helpdesk' as any) },
    ...(isOn('visitors') ? [{ id: 'tip-visitors', tone: 'coral' as const, icon: 'walk-outline' as const, title: 'Expecting a guest?', subtitle: 'Invite them in advance and the gate lets them in.', cta: 'Open visitors', onPress: () => router.push('/(app)/visitors' as any) }] : []),
    ...(isOn('forum') ? [{ id: 'tip-community', tone: 'violet' as const, icon: 'chatbubbles-outline' as const, title: 'Meet your neighbours', subtitle: 'Ask, share and chat on the community board.', cta: 'Open the board', onPress: () => router.push('/(app)/forum' as any) }] : []),
  ];
  const updates: UpdateItem[] = real.length >= 3 ? real : [...real, ...tips.slice(0, 3 - real.length)];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <BrandMark />
          <Text style={styles.greeting}>Hello, {user?.firstName} 👋</Text>
          <Text style={styles.flatInfo}>
            {user?.flatNumber
              ? `Flat ${user.flatNumber}${user.buildingName ? ` · ${user.buildingName}` : ''}`
              : user?.currentRole?.replace(/_/g, ' ') ?? 'Resident'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <NotificationBell onPress={() => router.push('/(app)/notifications' as any)} size={24} color={colors.text} />
          <TouchableOpacity onPress={() => router.push('/(app)/resident/profile')} hitSlop={8}>
            <View style={[styles.avatarCircle, { backgroundColor: brand.tint }]}>
              <Text style={[styles.avatarText, { color: brand.onTint }]}>
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={brand.color} />
        }
      >
        {/* Someone at the gate is the most urgent thing there is. */}
        <PendingVisitorBanner />

        {/* Current bill hero card */}
        <FadeInUp>
        <HeroCard>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>{periodLabel}</Text>
            {myBill && (
              <StatusBadge
                label={isPaid ? 'PAID' : 'PENDING'}
                variant={isPaid ? 'success' : 'warning'}
              />
            )}
          </View>

          {myBill ? (
            <>
              <View style={styles.heroMain}>
                <View style={{ flex: 1 }}>
                  <CountUp value={total} format={inr} style={styles.heroAmount} />
                  {!isPaid && (
                    <Text style={styles.heroDue}>
                      Outstanding: ₹{outstanding.toLocaleString('en-IN')} · Due{' '}
                      {myBill.dueDate
                        ? new Date(myBill.dueDate).toLocaleDateString('en-IN')
                        : 'soon'}
                    </Text>
                  )}
                </View>
                <ProgressRing
                  fraction={paidFraction}
                  label={`${Math.round(paidFraction * 100)}%`}
                  accessibilityLabel={`${Math.round(paidFraction * 100)} percent of this bill paid`}
                />
              </View>
              {!isPaid && (
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => router.push('/(app)/resident/payments/submit')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="card-outline" size={18} color={colors.textInverse} />
                  <Text style={styles.payBtnText}>I&apos;ve Made Payment</Text>
                </TouchableOpacity>
              )}
            </>
          ) : preview ? (
            <>
              <View style={styles.previewBadgeRow}>
                <StatusBadge label="PREVIEW" variant="info" size="sm" />
                <Text style={styles.previewNote}>Not yet published — may still change</Text>
              </View>
              <Text style={styles.heroAmount}>{inr(preview.totalAmount)}</Text>
              <TouchableOpacity
                style={styles.previewLink}
                onPress={() => router.push('/(app)/my-bills' as any)}
                activeOpacity={0.7}
              >
                <Text style={styles.previewLinkText}>See full breakdown</Text>
                <Ionicons name="chevron-forward" size={13} color={colors.textInverse} />
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.noBill}>No pending bill. You&apos;re all caught up!</Text>
          )}
        </HeroCard>
        </FadeInUp>

        {/* Quick stats: each on a soft card of its own colour, so what kind of figure it is shows before the digits are read. */}
        {myBill && (
          <FadeInUp delay={90} style={styles.statsRow}>
            <TintStatTile tone="blue" icon="receipt-outline" label="Total Bill" value={inr(myBill.totalAmount)} />
            <TintStatTile tone="green" icon="checkmark-circle-outline" label="Paid" value={inr(myBill.paidAmount)} progress={paidFraction} />
            <TintStatTile
              tone={outstanding > 0 ? 'amber' : 'green'}
              icon={outstanding > 0 ? 'alert-circle-outline' : 'happy-outline'}
              label="Due"
              value={`₹${outstanding.toLocaleString('en-IN')}`}
            />
          </FadeInUp>
        )}

        {/* What is happening: swipe sideways */}
        {updates.length > 0 && (
          <FadeInUp delay={180}>
            <SectionHeader
              title="What's Happening"
              action="Announcements"
              onAction={() => router.push('/(app)/resident/announcements')}
            />
            <UpdatesCarousel items={updates} />
          </FadeInUp>
        )}

        {/* Quick links — Maintenance Sheet, Documents and Finances existed
            only inside Profile's menu before, which several residents never
            found, so they sit here with the community and gate shortcuts. */}
        <FadeInUp delay={270}>
          <SectionHeader title="Quick Links" />
          <ActionGrid items={QUICK_LINKS.filter((a) => routeOn(a.route))} onOpen={(route) => router.push(route as any)} />
        </FadeInUp>

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: { ...typography.headingSmall, color: colors.text },
  flatInfo: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.labelMedium, color: colors.primary, fontWeight: '700' },

  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroLabel: { ...typography.labelLarge, color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
  heroAmount: { ...typography.displayLarge, color: colors.textInverse },
  heroDue: { ...typography.bodySmall, color: 'rgba(255,255,255,0.8)' },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  payBtnText: { ...typography.labelLarge, color: colors.textInverse },
  noBill: { ...typography.bodyMedium, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },

  previewBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewNote: { ...typography.bodySmall, color: 'rgba(255,255,255,0.8)', flexShrink: 1 },
  previewLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  previewLinkText: { ...typography.labelMedium, color: colors.textInverse, textDecorationLine: 'underline' },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    marginTop: spacing.base,
  },
});
