/**
 * Invitations my flat has made. The code itself is never shown here — it is
 * not stored in readable form — only what each invitation is and whether it
 * can still be used. A live one can be cancelled.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VisitorInvitation, visitorsApi } from '@/api/endpoints/visitors.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { fmtDayOf, fmtTime } from '@/utils/amenity-time';
import { INVITATION_STATE, visitorTypeLabel } from '@/utils/visitors';
import { colors, spacing, typography } from '@/theme';

export default function InvitationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({ queryKey: ['my-invitations'], queryFn: visitorsApi.myInvitations });

  const revoke = useMutation({
    mutationFn: (id: string) => visitorsApi.revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-invitations'] }),
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['my-invitations'] });
      Alert.alert('Could not cancel', apiErrorMessage(e, 'Please try again.'));
    },
  });

  const confirmRevoke = (inv: VisitorInvitation) =>
    Alert.alert(`Cancel the invitation for ${inv.visitorName}?`, 'Their code will stop working straight away.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel invitation', style: 'destructive', onPress: () => revoke.mutate(inv.id) },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader title="My invitations" showBack />
        {isLoading ? (
          <LoadingState message="Loading invitations…" />
        ) : isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load invitations" description="Check your connection and try again." actionLabel="Try again" onAction={() => refetch()} />
        ) : (
          <FlatList
            data={data ?? []}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            renderItem={({ item }) => {
              const state = INVITATION_STATE[item.state];
              const live = item.state === 'ACTIVE' || item.state === 'NOT_YET';
              return (
                <Card style={styles.card}>
                  <View style={styles.top}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{item.visitorName}</Text>
                      <Text style={styles.meta}>{visitorTypeLabel(item.visitorType)} · {item.usedCount} of {item.maxUses} used</Text>
                    </View>
                    <StatusBadge size="sm" label={state.label} variant={state.variant} />
                  </View>
                  <Text style={styles.time}>Until {fmtDayOf(item.validUntil)}, {fmtTime(item.validUntil)}</Text>
                  {live && <Button label="Cancel invitation" variant="outline" size="sm" onPress={() => confirmRevoke(item)} loading={revoke.isPending && revoke.variables === item.id} style={{ marginTop: spacing.sm }} />}
                </Card>
              );
            }}
            ListEmptyComponent={
              <EmptyState icon="ticket-outline" title="No invitations yet" description="Invite a guest ahead of time and they can walk straight in with their code." actionLabel="Invite a guest" onAction={() => router.push('/(app)/visitors/invite' as any)} />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
});
