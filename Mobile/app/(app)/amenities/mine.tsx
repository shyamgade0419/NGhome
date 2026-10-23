/**
 * My bookings — everything the signed-in resident's flat has booked: what is
 * coming up, what is waiting on the committee, and what is over. A household
 * shares its bookings, the same way bills and payments are shared by flat.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { amenityBookingsApi, apiErrorMessage, AmenityBooking, BookingStatus } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { fmtRange } from '@/utils/amenity-time';
import { inr, toNum } from '@/utils/format';
import { colors, spacing, typography } from '@/theme';

const STATUS: Record<BookingStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' }> = {
  PENDING: { label: 'Awaiting approval', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  REJECTED: { label: 'Declined', variant: 'error' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
};

const FEE_LABEL = { NONE: '', DUE: 'due', COLLECTED: 'paid', WAIVED: 'waived' } as const;

/** A booking can be cancelled while it is live and has not started. */
function canCancel(b: AmenityBooking): boolean {
  return (b.status === 'PENDING' || b.status === 'CONFIRMED') && new Date(b.startAt).getTime() > Date.now();
}

function BookingCard({
  booking,
  onCancel,
  cancelling,
}: {
  booking: AmenityBooking;
  onCancel: (b: AmenityBooking) => void;
  cancelling: boolean;
}) {
  const status = STATUS[booking.status];
  const fee = toNum(booking.feeAmount);
  const feeText = fee > 0 && booking.feeStatus !== 'NONE' ? `Fee ${inr(fee)} · ${FEE_LABEL[booking.feeStatus]}` : null;
  const past = new Date(booking.endAt).getTime() < Date.now();

  return (
    <Card style={[styles.card, past && { opacity: 0.7 }]}>
      <View style={styles.top}>
        <Text style={styles.name} numberOfLines={1}>{booking.amenity?.name ?? 'Amenity'}</Text>
        <StatusBadge size="sm" label={status.label} variant={status.variant} />
      </View>
      <Text style={styles.when}>{fmtRange(booking.startAt, booking.endAt)}</Text>
      {booking.guestCount > 0 ? <Text style={styles.meta}>{booking.guestCount} guest{booking.guestCount === 1 ? '' : 's'}</Text> : null}
      {feeText ? <Text style={styles.meta}>{feeText}</Text> : null}
      {booking.status === 'REJECTED' && booking.rejectionReason ? (
        <Text style={styles.reason}>Reason: {booking.rejectionReason}</Text>
      ) : null}
      {canCancel(booking) && (
        <Button label="Cancel booking" variant="outline" size="sm" onPress={() => onCancel(booking)} loading={cancelling} />
      )}
    </Card>
  );
}

export default function MyBookingsScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-amenity-bookings'],
    queryFn: amenityBookingsApi.mine,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => amenityBookingsApi.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-amenity-bookings'] });
      qc.invalidateQueries({ queryKey: ['amenity-availability'] });
    },
    onError: (err) => Alert.alert('Could not cancel', apiErrorMessage(err, 'Something went wrong. Please try again.')),
  });

  const confirmCancel = (b: AmenityBooking) =>
    Alert.alert(
      'Cancel this booking?',
      `${b.amenity?.name ?? 'Amenity'}\n${fmtRange(b.startAt, b.endAt)}`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel booking', style: 'destructive', onPress: () => cancel.mutate(b.id) },
      ],
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My bookings"
        showBack
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/(app)/amenities' as any))}
      />
      {isLoading ? (
        <LoadingState message="Loading your bookings…" />
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onCancel={confirmCancel}
              cancelling={cancel.isPending && cancel.variables === item.id}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="No bookings yet"
              description="Book the clubhouse, hall or court from the Amenities screen and it will show up here."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...typography.labelLarge, color: colors.text, flex: 1 },
  when: { ...typography.bodyMedium, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  reason: { ...typography.bodySmall, color: colors.error },
});
