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
import { useAuth } from '@/hooks/useAuth';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card, SectionHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { Announcement } from '@/types/society.types';

export default function ResidentDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  const { data: myBill, isLoading, refetch: refetchBill, isRefetching } = useQuery({
    queryKey: ['my-current-bill'],
    queryFn: billingApi.getMyCurrentBill,
  });

  const { data: announcements, refetch: refetchAnnouncements } = useQuery({
    queryKey: ['announcements-preview'],
    queryFn: () => societiesApi.getAnnouncements({ limit: 3 }),
  });

  const onRefresh = () => {
    refetchBill();
    refetchAnnouncements();
  };

  if (isLoading) return <LoadingState fullscreen message="Loading your account..." />;

  const outstanding = myBill ? parseFloat(myBill.pendingAmount) : 0;
  const isPaid = myBill?.isPaid ?? false;

  const periodLabel = myBill
    ? `${new Date(myBill.dueDate).toLocaleString('en-IN', { month: 'short', year: 'numeric' })} Maintenance`
    : 'Current Maintenance';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.firstName} 👋</Text>
          <Text style={styles.flatInfo}>
            {user?.currentRole?.replace(/_/g, ' ') ?? 'Resident'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push('/(app)/resident/notifications' as any)} hitSlop={8}>
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(app)/resident/profile')} hitSlop={8}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Current bill hero card */}
        <View style={styles.heroCard}>
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
              <Text style={styles.heroAmount}>
                ₹{parseFloat(myBill.totalAmount).toLocaleString('en-IN')}
              </Text>
              {!isPaid && (
                <Text style={styles.heroDue}>
                  Outstanding: ₹{outstanding.toLocaleString('en-IN')} · Due{' '}
                  {myBill.dueDate
                    ? new Date(myBill.dueDate).toLocaleDateString('en-IN')
                    : 'soon'}
                </Text>
              )}
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
          ) : (
            <Text style={styles.noBill}>No pending bill. You&apos;re all caught up!</Text>
          )}
        </View>

        {/* Quick stats */}
        {myBill && (
          <View style={styles.statsRow}>
            <Card style={styles.statBox} padding="md">
              <Text style={styles.statLabel}>Total Bill</Text>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                ₹{parseFloat(myBill.totalAmount).toLocaleString('en-IN')}
              </Text>
            </Card>
            <Card style={styles.statBox} padding="md">
              <Text style={styles.statLabel}>Paid</Text>
              <Text style={[styles.statValue, { color: colors.secondary }]}>
                ₹{parseFloat(myBill.paidAmount).toLocaleString('en-IN')}
              </Text>
            </Card>
            <Card style={styles.statBox} padding="md">
              <Text style={styles.statLabel}>Due</Text>
              <Text style={[styles.statValue, { color: outstanding > 0 ? colors.warning : colors.secondary }]}>
                ₹{outstanding.toLocaleString('en-IN')}
              </Text>
            </Card>
          </View>
        )}

        {/* Announcements preview */}
        <SectionHeader
          title="Announcements"
          action="View All"
          onAction={() => router.push('/(app)/resident/announcements')}
        />
        {(announcements?.data ?? []).length === 0 ? (
          <View style={styles.noAnnouncements}>
            <Text style={styles.noAnnouncementsText}>No announcements</Text>
          </View>
        ) : (
          (announcements?.data ?? []).map((item: Announcement) => (
            <TouchableOpacity key={item.id} style={styles.announcementCard} activeOpacity={0.8}>
              <View style={styles.announcementLeft}>
                <View style={[styles.priorityDot, getPriorityStyle(item.priority)]} />
              </View>
              <View style={styles.announcementBody}>
                <Text style={styles.announcementTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.announcementContent} numberOfLines={2}>{item.content}</Text>
                <Text style={styles.announcementDate}>
                  {item.publishAt ? new Date(item.publishAt).toLocaleDateString('en-IN') : ''}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case 'URGENT': return { backgroundColor: colors.error };
    case 'HIGH': return { backgroundColor: colors.warning };
    case 'NORMAL': return { backgroundColor: colors.info };
    default: return { backgroundColor: colors.textTertiary };
  }
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

  heroCard: {
    margin: spacing.base,
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: spacing.xl,
    gap: spacing.md,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { ...typography.labelLarge, color: 'rgba(255,255,255,0.8)' },
  heroAmount: { ...typography.displayLarge, color: colors.textInverse },
  heroDue: { ...typography.bodySmall, color: 'rgba(255,255,255,0.7)' },
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
  noBill: { ...typography.bodyMedium, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  statBox: { flex: 1 },
  statLabel: { ...typography.labelSmall, color: colors.textSecondary },
  statValue: { ...typography.headingSmall, marginTop: 4 },

  noAnnouncements: { paddingHorizontal: spacing.base, paddingVertical: spacing.xl, alignItems: 'center' },
  noAnnouncementsText: { ...typography.bodyMedium, color: colors.textTertiary },

  announcementCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  announcementLeft: { paddingTop: 6 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  announcementBody: { flex: 1, gap: 3 },
  announcementTitle: { ...typography.labelLarge, color: colors.text },
  announcementContent: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  announcementDate: { ...typography.bodySmall, color: colors.textTertiary },
});
