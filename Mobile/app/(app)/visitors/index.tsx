/**
 * Visitors at my flat. A request waiting for an answer comes first, with the
 * two buttons that matter; everything after it is a record of who came.
 * Answers are final and made by the server: if someone else in the household
 * answered first, or the request lapsed, this says so and refreshes.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VisitorEntry, visitorsApi } from '@/api/endpoints/visitors.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ENTRY_STATUS, awaitingResident, timeline, visitorTypeLabel } from '@/utils/visitors';
import { colors, spacing, typography } from '@/theme';

function VisitorCard({ entry, onApprove, onDecline, busy }: { entry: VisitorEntry; onApprove: () => void; onDecline: () => void; busy: boolean }) {
  const status = ENTRY_STATUS[entry.status];
  const waiting = awaitingResident(entry);
  return (
    <Card style={[styles.card, waiting && styles.waiting]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{entry.visitorName}</Text>
          <Text style={styles.meta}>
            {visitorTypeLabel(entry.visitorType)}
            {entry.vehicleNumber ? ` · ${entry.vehicleNumber}` : ''}
            {entry.purpose ? ` · ${entry.purpose}` : ''}
          </Text>
        </View>
        <StatusBadge size="sm" label={status.label} variant={status.variant} />
      </View>
      <Text style={styles.time}>{timeline(entry)}</Text>
      {entry.decisionMethod === 'ADMIN_OVERRIDE' && <Text style={styles.time}>Decided by the committee{entry.decisionNote ? `: ${entry.decisionNote}` : ''}</Text>}
      {entry.decisionMethod === 'INVITATION' && <Text style={styles.time}>Arrived with your invitation</Text>}

      {waiting && (
        <View style={styles.answerRow}>
          <Button label="Approve" onPress={onApprove} loading={busy} style={{ flex: 1 }} />
          <Button label="Decline" variant="outline" onPress={onDecline} disabled={busy} style={{ flex: 1 }} />
        </View>
      )}
    </Card>
  );
}

export default function VisitorsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['my-visitors'],
    queryFn: () => visitorsApi.myVisitors(),
    refetchInterval: 15_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-visitors'] });
    qc.invalidateQueries({ queryKey: ['my-visitors-pending'] });
  };
  const onError = (e: unknown) => {
    refresh(); // the server may already hold a different answer
    Alert.alert('Could not answer', apiErrorMessage(e, 'Please try again.'));
  };

  const approve = useMutation({ mutationFn: (id: string) => visitorsApi.approve(id), onSuccess: refresh, onError });
  const decline = useMutation({ mutationFn: (id: string) => visitorsApi.reject(id), onSuccess: refresh, onError });
  const busyId = (approve.isPending && approve.variables) || (decline.isPending && decline.variables) || null;

  const confirmDecline = (e: VisitorEntry) =>
    Alert.alert(`Decline ${e.visitorName}?`, 'The guard will be told not to let them in.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => decline.mutate(e.id) },
    ]);

  // Requests waiting for an answer first; the rest keep the server's newest-first order.
  const entries = [...(data ?? [])].sort((a, b) => Number(awaitingResident(b)) - Number(awaitingResident(a)));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Visitors"
          subtitle="Who is at your door"
          showBack
          rightAction={
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => router.push('/(app)/visitors/invitations' as any)} hitSlop={8} accessibilityLabel="My invitations">
                <Ionicons name="list-outline" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/(app)/visitors/invite' as any)} hitSlop={8} accessibilityLabel="Invite a guest">
                <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
              </TouchableOpacity>
            </View>
          }
        />

        {isLoading ? (
          <LoadingState message="Loading visitors…" />
        ) : isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load visitors" description="Check your connection and try again." actionLabel="Try again" onAction={() => refetch()} />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            renderItem={({ item }) => (
              <VisitorCard
                entry={item}
                busy={busyId === item.id}
                onApprove={() => approve.mutate(item.id)}
                onDecline={() => confirmDecline(item)}
              />
            )}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title="No visitors yet"
                description="When someone arrives at the gate for your flat, you will be asked here. You can also invite a guest ahead of time, so they walk straight in."
                actionLabel="Invite a guest"
                onAction={() => router.push('/(app)/visitors/invite' as any)}
              />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  waiting: { borderWidth: 1.5, borderColor: colors.warning },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  answerRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
