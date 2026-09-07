/**
 * Resident — Meetings
 *
 * Read-only: view published AGM / committee meeting agendas and minutes.
 * Admin's screen (admin/meetings/index.tsx) is where meetings get created,
 * minutes get written, and publishing happens — the backend already only
 * ever returns published meetings to a RESIDENT-role caller (see
 * MeetingsService.findAll/findOne), so this screen never has to filter
 * anything itself.
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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { meetingsApi, SocietyMeeting } from '@/api/endpoints/meetings.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

function MeetingDetailModal({ meeting, onClose }: { meeting: SocietyMeeting; onClose: () => void }) {
  const { data: full, isLoading } = useQuery({
    queryKey: ['meeting', meeting.id],
    queryFn: () => meetingsApi.get(meeting.id),
  });
  const m = full ?? meeting;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{m.title}</Text>
            <Text style={styles.modalSub}>
              {new Date(m.meetingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          {isLoading ? (
            <LoadingState message="Loading…" />
          ) : (
            <>
              {m.location ? (
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.infoText}>{m.location}</Text>
                </View>
              ) : null}

              {m.agenda ? (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Agenda</Text>
                  <Text style={styles.blockText}>{m.agenda}</Text>
                </View>
              ) : null}

              {m.minutes ? (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Minutes</Text>
                  {m.minutes.summary ? (
                    <Text style={styles.minutesSummary}>{m.minutes.summary}</Text>
                  ) : null}
                  <Text style={styles.blockText}>{m.minutes.content}</Text>
                </View>
              ) : (
                <Text style={styles.noMinutes}>Minutes haven&apos;t been published for this meeting yet.</Text>
              )}
            </>
          )}
          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ResidentMeetingsScreen() {
  const [selected, setSelected] = useState<SocietyMeeting | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['resident-meetings'],
    queryFn: () => meetingsApi.list({ limit: 50 }),
  });

  const meetings = data?.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Meetings" showBack />

      {isLoading ? (
        <LoadingState message="Loading meetings…" />
      ) : isError ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load meetings" description="Pull down to retry." />
      ) : (
        <FlatList
          data={meetings}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={() => setSelected(item)}>
              <View style={styles.dateChip}>
                <Text style={styles.dateDay}>
                  {new Date(item.meetingDate).toLocaleDateString('en-IN', { day: 'numeric' })}
                </Text>
                <Text style={styles.dateMon}>
                  {new Date(item.meetingDate).toLocaleDateString('en-IN', { month: 'short' })}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.location ? <Text style={styles.rowMeta}>{item.location}</Text> : null}
                <Text style={styles.rowMinutes}>
                  {item.minutes ? 'Minutes available' : 'Minutes not yet published'}
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="No meetings yet"
              description="Published AGM and committee meeting minutes will appear here."
            />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {selected && <MeetingDetailModal meeting={selected} onClose={() => setSelected(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base },

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
  dateChip: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  dateDay: { ...typography.headingSmall, color: colors.primary, fontWeight: '700', lineHeight: 20 },
  dateMon: { ...typography.labelSmall, color: colors.primary, fontSize: 10, textTransform: 'uppercase' },

  rowTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  rowMinutes: { ...typography.bodySmall, color: colors.textSecondary, fontSize: 11, marginTop: 3 },

  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },
  modalBody: { padding: spacing.base },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  infoText: { ...typography.bodyMedium, color: colors.textSecondary },

  block: { marginBottom: spacing.base, gap: 4 },
  blockLabel: {
    ...typography.labelSmall, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  blockText: { ...typography.bodyMedium, color: colors.text, lineHeight: 21 },
  minutesSummary: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },

  noMinutes: { ...typography.bodyMedium, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl },
});
