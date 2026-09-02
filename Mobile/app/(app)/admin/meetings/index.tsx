/**
 * Admin — Meetings
 *
 * Lists AGM / committee meetings with agenda and minutes. Minutes can be
 * added and published from here; attendee management stays on the web where
 * the multi-row entry form is workable.
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
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { meetingsApi, SocietyMeeting } from '@/api/endpoints/meetings.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

// ── Detail / minutes sheet ───────────────────────────────────────────────────

function MeetingModal({ meeting, onClose }: { meeting: SocietyMeeting; onClose: () => void }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(meeting.minutes?.content ?? '');

  const { data: full, isLoading } = useQuery({
    queryKey: ['meeting', meeting.id],
    queryFn: () => meetingsApi.get(meeting.id),
  });

  const saveMinutes = useMutation({
    mutationFn: () => meetingsApi.addMinutes(meeting.id, { content: minutes.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
      Alert.alert('Saved', 'Minutes recorded for this meeting.');
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save minutes.'),
  });

  const publish = useMutation({
    mutationFn: () => meetingsApi.publish(meeting.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
      Alert.alert('Published', 'Residents can now read these minutes.');
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to publish.'),
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

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
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

                {(m.attendees?.length ?? 0) > 0 && (
                  <View style={styles.block}>
                    <Text style={styles.blockLabel}>Attendees ({m.attendees!.length})</Text>
                    <Text style={styles.blockText}>
                      {m.attendees!.map((a) => a.name + (a.flatCode ? ` (${a.flatCode})` : '')).join(', ')}
                    </Text>
                  </View>
                )}

                <Text style={styles.blockLabel}>Minutes</Text>
                <TextInput
                  style={styles.minutesInput}
                  value={minutes}
                  onChangeText={setMinutes}
                  placeholder="Record what was discussed and decided…"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  textAlignVertical="top"
                />

                <Button
                  label={saveMinutes.isPending ? 'Saving…' : 'Save Minutes'}
                  onPress={() => {
                    if (!minutes.trim()) {
                      Alert.alert('Required', 'Enter the minutes before saving.');
                      return;
                    }
                    saveMinutes.mutate();
                  }}
                  loading={saveMinutes.isPending}
                  fullWidth
                  style={{ marginTop: spacing.md }}
                />

                {!m.isPublished && (
                  <Button
                    label={publish.isPending ? 'Publishing…' : 'Publish to Residents'}
                    onPress={() =>
                      Alert.alert('Publish Minutes', 'Residents will be able to read these minutes. Continue?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Publish', onPress: () => publish.mutate() },
                      ])
                    }
                    loading={publish.isPending}
                    variant="outline"
                    fullWidth
                    style={{ marginTop: spacing.sm }}
                  />
                )}
              </>
            )}
            <View style={{ height: spacing['3xl'] }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function MeetingsScreen() {
  const [selected, setSelected] = useState<SocietyMeeting | null>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['meetings'],
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
          renderItem={({ item }) => {
            const past = new Date(item.meetingDate) < new Date();
            return (
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
                  <View style={styles.badgeRow}>
                    <StatusBadge
                      label={item.isPublished ? 'PUBLISHED' : past ? 'MINUTES DUE' : 'SCHEDULED'}
                      variant={item.isPublished ? 'success' : past ? 'warning' : 'info'}
                      size="sm"
                    />
                    {item.minutes ? (
                      <Text style={styles.hasMinutes}>· minutes recorded</Text>
                    ) : null}
                  </View>
                </View>

                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <EmptyState icon="calendar-outline" title="No meetings" description="Scheduled AGMs and committee meetings appear here." />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}

      {selected && <MeetingModal meeting={selected} onClose={() => setSelected(null)} />}
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
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  hasMinutes: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },

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

  minutesInput: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 140,
    ...typography.bodyMedium,
    color: colors.text,
    textAlignVertical: 'top',
  },
});
