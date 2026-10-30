/**
 * The gate's staff: who is on duty today, who is in, and a way to check someone in or record them
 * leaving. The committee plans shifts and corrects days on the web; this is the guard's half. The
 * server keeps one record per person per day, so a double tap or a second guard cannot make a
 * second one. No pay details or phone numbers are shown or even sent.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GateStaff, staffApi } from '@/api/endpoints/staff.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { canCheckIn, canCheckOut, dutyLine, dutySummary, staffBadge, timesLine } from '@/utils/staff';
import { colors, spacing, typography } from '@/theme';

export function StaffPanel() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['gate-staff'], queryFn: staffApi.gateStaff, refetchInterval: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['gate-staff'] });

  const checkIn = useMutation({
    mutationFn: (s: GateStaff) => staffApi.checkIn(s.employeeId),
    onSuccess: (res, s) => {
      refresh();
      if (res.alreadyIn) Alert.alert('Already in', `${s.name} was already checked in.`);
    },
    onError: (e) => {
      refresh();
      Alert.alert('Could not check in', apiErrorMessage(e, 'Check the connection and try again.'));
    },
  });

  const checkOut = useMutation({
    mutationFn: (s: GateStaff) => staffApi.checkOut(s.employeeId),
    onSuccess: refresh,
    onError: (e) => {
      refresh();
      Alert.alert('Could not check out', apiErrorMessage(e, 'Check the connection and try again.'));
    },
  });

  const confirmOut = (s: GateStaff) =>
    Alert.alert(`Record ${s.name} leaving?`, 'This notes the time they left the premises.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Check out', onPress: () => checkOut.mutate(s) },
    ]);

  const staff = list.data ?? [];
  const busyIn = checkIn.isPending ? checkIn.variables?.employeeId : undefined;
  const busyOut = checkOut.isPending ? checkOut.variables?.employeeId : undefined;

  return (
    <View style={{ flex: 1 }}>
      {list.isLoading ? (
        <LoadingState message="Loading staff…" />
      ) : list.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Can't reach the server" description="Check the connection and try again." actionLabel="Try again" onAction={() => list.refetch()} />
      ) : (
        <FlatList
          data={staff}
          keyExtractor={(s) => s.employeeId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />}
          ListHeaderComponent={staff.length ? <Text style={styles.summary}>{dutySummary(staff)}</Text> : null}
          renderItem={({ item }) => {
            const badge = staffBadge(item);
            const duty = dutyLine(item);
            const times = timesLine(item);
            return (
              <Card style={styles.card}>
                <View style={styles.top}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.meta}>{item.designation}</Text>
                  </View>
                  <StatusBadge size="sm" label={badge.label} variant={badge.variant} />
                </View>
                {duty ? <Text style={styles.duty}>{duty}</Text> : null}
                {times ? <Text style={styles.time}>{times}</Text> : null}
                {canCheckIn(item) && <Button label="Check in" onPress={() => checkIn.mutate(item)} loading={busyIn === item.employeeId} fullWidth style={styles.action} />}
                {canCheckOut(item) && <Button label="Check out" variant="outline" onPress={() => confirmOut(item)} loading={busyOut === item.employeeId} fullWidth style={styles.action} />}
              </Card>
            );
          }}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title="No staff yet" description="The committee adds staff under Salaries on the web. They appear here to be checked in." />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.base, gap: spacing.md },
  summary: { ...typography.labelLarge, color: colors.textSecondary, marginBottom: spacing.xs },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  duty: { ...typography.bodySmall, color: colors.text },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  action: { marginTop: spacing.sm },
});
