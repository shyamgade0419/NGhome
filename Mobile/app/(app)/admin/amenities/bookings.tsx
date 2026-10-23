/**
 * Committee — booking requests and bookings. Approve or decline requests,
 * cancel a booking on a resident's behalf, and record that a fee was received
 * into a society account (which credits that account and writes the ledger
 * entry — the same bookkeeping as marking an expense paid, in the other
 * direction).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AmenityBooking, BookingStatus, amenityBookingsApi, apiErrorMessage } from '@/api/endpoints/amenities.api';
import { accountsApi } from '@/api/endpoints/accounts.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { fmtRange } from '@/utils/amenity-time';
import { inr, toNum } from '@/utils/format';
import { colors, spacing, typography, radius } from '@/theme';

type Filter = 'PENDING' | 'CONFIRMED' | 'ALL';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'PENDING', label: 'Requests' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'ALL', label: 'All' },
];

const STATUS: Record<BookingStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }> = {
  PENDING: { label: 'Awaiting approval', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  REJECTED: { label: 'Declined', variant: 'error' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
};

const FEE: Record<string, string> = { DUE: 'due', COLLECTED: 'collected', WAIVED: 'waived' };

export default function AmenityBookingsScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [rejecting, setRejecting] = useState<AmenityBooking | null>(null);
  const [reason, setReason] = useState('');
  const [collecting, setCollecting] = useState<AmenityBooking | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['amenity-bookings-admin', filter],
    queryFn: () => amenityBookingsApi.all(filter === 'ALL' ? undefined : { status: filter }),
  });

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['amenity-bookings-admin'] });
    qc.invalidateQueries({ queryKey: ['amenity-availability'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };
  const fail = (title: string) => (err: unknown) =>
    Alert.alert(title, apiErrorMessage(err, 'Something went wrong. Please try again.'));

  const approve = useMutation({ mutationFn: (id: string) => amenityBookingsApi.approve(id), onSuccess: refresh, onError: fail('Could not approve') });
  const reject = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => amenityBookingsApi.reject(id, why.trim() || undefined),
    onSuccess: () => {
      refresh();
      closeReject();
    },
    onError: fail('Could not decline'),
  });
  const cancel = useMutation({ mutationFn: (id: string) => amenityBookingsApi.cancel(id), onSuccess: refresh, onError: fail('Could not cancel') });
  const waive = useMutation({ mutationFn: (id: string) => amenityBookingsApi.waiveFee(id), onSuccess: refresh, onError: fail('Could not waive') });
  const collect = useMutation({
    mutationFn: ({ id, account }: { id: string; account: string }) => amenityBookingsApi.collectFee(id, account),
    onSuccess: () => {
      refresh();
      closeCollect();
    },
    onError: fail('Could not record the fee'),
  });

  const closeReject = useCallback(() => {
    setRejecting(null);
    setReason('');
  }, []);
  const closeCollect = useCallback(() => {
    setCollecting(null);
    setAccountId(null);
  }, []);

  // Same preselect rule as marking an expense paid: with one account, nothing to choose.
  const openCollect = (b: AmenityBooking) => {
    setAccountId(accounts && accounts.length === 1 ? accounts[0].id : null);
    setCollecting(b);
  };

  const confirmCollect = () => {
    if (!collecting || collect.isPending) return;
    if (!accounts || accounts.length === 0) {
      Alert.alert('No account to credit', 'Add a bank account or cash box under Accounts first — a collected fee is added to an account.');
      return;
    }
    if (!accountId) {
      Alert.alert('Choose an account', 'Tap the account the fee was paid into, then confirm.');
      return;
    }
    collect.mutate({ id: collecting.id, account: accountId });
  };

  const confirmCancel = (b: AmenityBooking) =>
    Alert.alert('Cancel this booking?', `${b.amenity?.name ?? 'Amenity'} · ${fmtRange(b.startAt, b.endAt)}\nThe resident will be told.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => cancel.mutate(b.id) },
    ]);

  const renderItem = ({ item: b }: { item: AmenityBooking }) => {
    const s = STATUS[b.status];
    const fee = toNum(b.feeAmount);
    const future = new Date(b.startAt).getTime() > Date.now();
    const live = b.status === 'PENDING' || b.status === 'CONFIRMED';
    return (
      <Card style={styles.card}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{b.amenity?.name ?? 'Amenity'}</Text>
          <StatusBadge size="sm" label={s.label} variant={s.variant} />
        </View>
        <Text style={styles.when}>{fmtRange(b.startAt, b.endAt)}</Text>
        <Text style={styles.meta}>
          {b.flat?.flatCode ?? '—'} · {b.user ? `${b.user.firstName} ${b.user.lastName}` : 'Resident'}
          {b.guestCount > 0 ? ` · ${b.guestCount} guest${b.guestCount === 1 ? '' : 's'}` : ''}
        </Text>
        {b.note ? <Text style={styles.note}>“{b.note}”</Text> : null}
        {fee > 0 && b.feeStatus !== 'NONE' ? <Text style={styles.meta}>Fee {inr(fee)} · {FEE[b.feeStatus]}</Text> : null}
        {b.status === 'REJECTED' && b.rejectionReason ? <Text style={styles.reason}>Reason: {b.rejectionReason}</Text> : null}

        <View style={styles.actions}>
          {b.status === 'PENDING' && future && (
            <>
              <Button label="Approve" size="sm" onPress={() => approve.mutate(b.id)} loading={approve.isPending && approve.variables === b.id} />
              <Button label="Decline" size="sm" variant="outline" onPress={() => setRejecting(b)} />
            </>
          )}
          {b.status === 'CONFIRMED' && b.feeStatus === 'DUE' && (
            <>
              <Button label="Fee collected" size="sm" onPress={() => openCollect(b)} />
              <Button label="Waive fee" size="sm" variant="outline" onPress={() => waive.mutate(b.id)} loading={waive.isPending && waive.variables === b.id} />
            </>
          )}
          {live && future && <Button label="Cancel" size="sm" variant="outline" onPress={() => confirmCancel(b)} />}
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Bookings" subtitle="Requests and reservations" showBack />

        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipActive]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f.key }}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {isLoading ? (
          <LoadingState message="Loading bookings…" />
        ) : (
          <FlatList
            data={data?.data ?? []}
            keyExtractor={(b) => b.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            renderItem={renderItem}
            ListEmptyComponent={
              <EmptyState
                icon="calendar-outline"
                title={filter === 'PENDING' ? 'No requests waiting' : 'No bookings'}
                description={filter === 'PENDING' ? 'New requests for amenities that need approval appear here.' : 'Nothing booked yet.'}
              />
            }
          />
        )}

        <InlineSheet visible={!!rejecting} onRequestClose={() => !reject.isPending && closeReject()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Decline request</Text>
            <TouchableOpacity onPress={closeReject} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {rejecting && (
            <Text style={styles.meta}>
              {rejecting.amenity?.name} · {fmtRange(rejecting.startAt, rejecting.endAt)}
            </Text>
          )}
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (the resident will see this)"
            placeholderTextColor={colors.textTertiary}
            maxLength={300}
            multiline
          />
          <Button
            label="Decline request"
            variant="danger"
            onPress={() => rejecting && reject.mutate({ id: rejecting.id, why: reason })}
            loading={reject.isPending}
            fullWidth
          />
        </InlineSheet>

        <InlineSheet visible={!!collecting} onRequestClose={() => !collect.isPending && closeCollect()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Fee collected</Text>
            <TouchableOpacity onPress={closeCollect} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {collecting && (
            <Text style={styles.meta}>
              {collecting.amenity?.name} · {inr(collecting.feeAmount)}
            </Text>
          )}
          <Text style={styles.fieldLabel}>Paid into</Text>
          {(accounts ?? []).length === 0 ? (
            <Text style={styles.warn}>No accounts yet. Add a bank account or cash box under Accounts first.</Text>
          ) : null}
          <ScrollView style={{ maxHeight: 200, flexGrow: 0 }}>
            {(accounts ?? []).map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.accountRow, accountId === a.id && styles.accountRowActive]}
                onPress={() => setAccountId(a.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: accountId === a.id }}
              >
                <Ionicons
                  name={accountId === a.id ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={accountId === a.id ? colors.primary : colors.textTertiary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>{a.name}</Text>
                  <Text style={styles.meta}>{inr(a.currentBalance)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.hint}>Adds this amount to the account and records it in that account&apos;s ledger.</Text>
          <Button label="Record fee" onPress={confirmCollect} loading={collect.isPending} fullWidth />
        </InlineSheet>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...typography.labelLarge, color: colors.text, flex: 1 },
  when: { ...typography.bodyMedium, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  note: { ...typography.bodySmall, color: colors.textSecondary, fontStyle: 'italic' },
  reason: { ...typography.bodySmall, color: colors.error },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  fieldLabel: { ...typography.labelMedium, color: colors.textSecondary },
  warn: { ...typography.bodySmall, color: colors.warning },
  hint: { ...typography.bodySmall, color: colors.textTertiary },
  input: {
    ...typography.bodyMedium,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  accountRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  accountName: { ...typography.bodyMedium, color: colors.text },
});
