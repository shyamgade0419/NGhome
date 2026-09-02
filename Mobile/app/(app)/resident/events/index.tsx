/**
 * Resident — Events & Activities (read-only)
 *
 * Same Event model admins manage, filtered server-side to
 * isVisibleToResidents:true — this screen never has to be trusted to hide
 * anything the admin didn't intend to share. Split into Upcoming/Past
 * client-side since the list is typically short.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { eventsApi, SocietyEvent, EventStatus } from '@/api/endpoints/events.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

function statusVariant(status: EventStatus): 'info' | 'success' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'neutral';
  return 'info';
}

function EventRow({ event, onPress }: { event: SocietyEvent; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={onPress}>
      <View style={styles.dateChip}>
        <Text style={styles.dateDay}>
          {new Date(event.eventDate).toLocaleDateString('en-IN', { day: 'numeric' })}
        </Text>
        <Text style={styles.dateMon}>
          {new Date(event.eventDate).toLocaleDateString('en-IN', { month: 'short' })}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.badgeRow}>
          <StatusBadge label={event.status} variant={statusVariant(event.status)} size="sm" />
          {(event.actualCost || event.estimatedCost) ? (
            <Text style={styles.rowMeta}>· {inr(event.actualCost || event.estimatedCost)}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function EventDetailModal({ event, onClose }: { event: SocietyEvent; onClose: () => void }) {
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{event.title}</Text>
            <Text style={styles.modalSub}>
              {new Date(event.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <StatusBadge label={event.status} variant={statusVariant(event.status)} />

          {event.description ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Details</Text>
              <Text style={styles.blockText}>{event.description}</Text>
            </View>
          ) : null}

          {(event.estimatedCost || event.actualCost) ? (
            <View style={styles.costCard}>
              {event.estimatedCost ? (
                <View style={styles.costCardRow}>
                  <Text style={styles.blockLabel}>Estimated</Text>
                  <Text style={styles.blockText}>{inr(event.estimatedCost)}</Text>
                </View>
              ) : null}
              {event.actualCost ? (
                <View style={styles.costCardRow}>
                  <Text style={styles.blockLabel}>Actual</Text>
                  <Text style={[styles.blockText, { color: colors.primary, fontWeight: '700' }]}>
                    {inr(event.actualCost)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {event.fund ? (
            <View style={styles.infoRow}>
              <Ionicons name="shield-checkmark-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.infoText}>Linked to {event.fund.name}</Text>
            </View>
          ) : null}

          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ResidentEventsScreen() {
  const [selected, setSelected] = useState<SocietyEvent | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['resident-events'],
    queryFn: () => eventsApi.list({ limit: 100 }),
  });

  const events = data?.data ?? [];
  const now = new Date();
  const upcoming = events
    .filter((e) => e.status !== 'CANCELLED' && new Date(e.eventDate) >= now)
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  const past = events
    .filter((e) => e.status === 'CANCELLED' || new Date(e.eventDate) < now)
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Events & Activities" showBack />

      {isLoading ? (
        <LoadingState message="Loading events…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load events" description="Pull down to retry." />
      ) : events.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="Nothing planned yet"
          description="Society events and planned activities like AMC servicing or tank cleaning will appear here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        >
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcoming.map((e) => (
                <EventRow key={e.id} event={e} onPress={() => setSelected(e)} />
              ))}
            </>
          )}

          {past.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: upcoming.length > 0 ? spacing.lg : 0 }]}>Past</Text>
              {past.map((e) => (
                <EventRow key={e.id} event={e} onPress={() => setSelected(e)} />
              ))}
            </>
          )}

          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      )}

      {selected && <EventDetailModal event={selected} onClose={() => setSelected(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.sm },

  sectionTitle: {
    ...typography.labelSmall, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  dateChip: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  dateDay: { ...typography.headingSmall, color: colors.primary, fontWeight: '700', lineHeight: 20 },
  dateMon: { ...typography.labelSmall, color: colors.primary, fontSize: 10, textTransform: 'uppercase' },

  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  modalBody: { padding: spacing.base, gap: spacing.sm },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { ...typography.bodyMedium, color: colors.textSecondary },

  block: { gap: 4 },
  blockLabel: {
    ...typography.labelSmall, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  blockText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },

  costCard: {
    flexDirection: 'row', gap: spacing.xl,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  costCardRow: { gap: 2 },
});
