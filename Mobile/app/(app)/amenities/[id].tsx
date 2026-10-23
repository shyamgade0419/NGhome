/**
 * Book an amenity: pick a day, pick a slot (or a run of consecutive slots
 * where the amenity allows it), confirm. Availability is always fetched
 * fresh — a slot that looked free a minute ago may not be — and the server
 * makes the final call, so "That slot was just taken" is a normal outcome
 * that simply refreshes the grid.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { amenitiesApi, amenityBookingsApi, apiErrorMessage, Slot } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { addDays, fmtDay, fmtMinutes, fmtRange, fmtTime, istDateString } from '@/utils/amenity-time';
import { Selection, selectSlot, selectionEnd } from '@/utils/slot-selection';
import { inr } from '@/utils/format';
import { colors, spacing, typography, radius } from '@/theme';

const MAX_DATE_CHIPS = 60;

function SlotChip({
  slot,
  selected,
  showRemaining,
  onPress,
}: {
  slot: Slot;
  selected: boolean;
  showRemaining: boolean;
  onPress: () => void;
}) {
  const open = slot.state === 'AVAILABLE';
  const label = slot.bookedByMyFlat ? 'Yours' : slot.state === 'FULL' ? 'Full' : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!open}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !open }}
      style={[
        styles.slot,
        selected && styles.slotSelected,
        !open && styles.slotDisabled,
        slot.bookedByMyFlat && styles.slotMine,
      ]}
    >
      <Text style={[styles.slotTime, selected && styles.slotTimeSelected, !open && styles.slotTimeDisabled]}>
        {fmtTime(slot.startAt)}
      </Text>
      {label ? (
        <Text style={[styles.slotNote, slot.bookedByMyFlat && { color: colors.primary }]}>{label}</Text>
      ) : showRemaining && open ? (
        <Text style={[styles.slotNote, selected && { color: colors.textInverse }]}>{slot.remaining} left</Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function BookAmenityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const today = useMemo(() => istDateString(new Date()), []);
  const [date, setDate] = useState(today);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [guests, setGuests] = useState(0);
  const [note, setNote] = useState('');

  const { data: amenities, isLoading: loadingAmenity } = useQuery({
    queryKey: ['amenities'],
    queryFn: () => amenitiesApi.list(),
  });
  const amenity = amenities?.find((a) => a.id === id);

  const { data: availability, isLoading: loadingSlots, isFetching, refetch } = useQuery({
    queryKey: ['amenity-availability', id, date],
    queryFn: () => amenitiesApi.availability(id, date),
    enabled: !!amenity,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const slots = availability?.slots ?? [];
  const dates = useMemo(
    () =>
      amenity
        ? Array.from({ length: Math.min(amenity.maxAdvanceDays + 1, MAX_DATE_CHIPS) }, (_, i) => addDays(today, i))
        : [],
    [amenity, today],
  );

  const range = selection
    ? { startAt: slots[selection.start]?.startAt, endAt: slots[selectionEnd(selection)]?.endAt }
    : null;

  const book = useMutation({
    mutationFn: () =>
      amenityBookingsApi.book({
        amenityId: id,
        startAt: range!.startAt,
        slots: selection!.count,
        guestCount: guests,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amenity-availability', id] });
      qc.invalidateQueries({ queryKey: ['my-amenity-bookings'] });
      setSheetOpen(false);
      setSelection(null);
      setGuests(0);
      setNote('');
      // My bookings shows the new booking with its status ("Confirmed" or
      // "Awaiting approval"), so no extra confirmation dialog is needed.
      router.replace('/(app)/amenities/mine' as any);
    },
    onError: (err) => {
      setSheetOpen(false);
      setSelection(null);
      refetch();
      Alert.alert('Could not book', apiErrorMessage(err, 'Something went wrong. Please try again.'));
    },
  });

  if (loadingAmenity) return <LoadingState fullscreen message="Loading…" />;
  if (!amenity) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Amenity" showBack />
        <EmptyState icon="calendar-outline" title="Amenity not found" description="It may have been removed by the committee." />
      </SafeAreaView>
    );
  }

  const needsApproval = amenity.bookingMode === 'NEEDS_APPROVAL';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title={amenity.name}
          subtitle={`${fmtMinutes(amenity.opensAtMin)} – ${fmtMinutes(amenity.closesAtMin)}`}
          showBack
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {(amenity.description || amenity.rules) && (
            <View style={styles.info}>
              {amenity.description ? <Text style={styles.infoText}>{amenity.description}</Text> : null}
              {amenity.rules ? (
                <Text style={styles.rules}>
                  <Text style={{ fontWeight: '600' }}>Rules: </Text>
                  {amenity.rules}
                </Text>
              ) : null}
            </View>
          )}

          <View style={styles.facts}>
            <Text style={styles.fact}>{needsApproval ? 'Needs committee approval' : 'Confirmed instantly'}</Text>
            <Text style={styles.fact}>{amenity.fee ? `${inr(amenity.fee)} per booking` : 'Free'}</Text>
            {amenity.maxSlotsPerBooking > 1 && (
              <Text style={styles.fact}>Up to {amenity.maxSlotsPerBooking} slots at a time</Text>
            )}
          </View>

          <Text style={styles.sectionLabel}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dates}>
            {dates.map((d) => {
              const active = d === date;
              const [weekday, rest] = fmtDay(d).split(', ');
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.dateChip, active && styles.dateChipActive]}
                  onPress={() => {
                    setDate(d);
                    setSelection(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.dateWeekday, active && styles.dateTextActive]}>{weekday}</Text>
                  <Text style={[styles.dateDay, active && styles.dateTextActive]}>{rest}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>
            Time {amenity.maxSlotsPerBooking > 1 ? '(tap the next slot to extend)' : ''}
          </Text>
          {loadingSlots ? (
            <LoadingState message="Checking availability…" />
          ) : slots.length === 0 ? (
            <Text style={styles.empty}>No slots on this day.</Text>
          ) : (
            <View style={[styles.grid, isFetching && { opacity: 0.6 }]}>
              {slots.map((slot, i) => (
                <SlotChip
                  key={slot.startAt}
                  slot={slot}
                  selected={!!selection && i >= selection.start && i <= selectionEnd(selection)}
                  showRemaining={amenity.capacity > 1}
                  onPress={() => setSelection((cur) => selectSlot(slots, cur, i, amenity.maxSlotsPerBooking))}
                />
              ))}
            </View>
          )}
        </ScrollView>

        {range?.startAt && range.endAt && (
          <View style={styles.bar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.barLabel}>Selected</Text>
              <Text style={styles.barValue}>{fmtRange(range.startAt, range.endAt)}</Text>
            </View>
            <Button label="Continue" onPress={() => setSheetOpen(true)} />
          </View>
        )}

        <InlineSheet visible={sheetOpen} onRequestClose={() => !book.isPending && setSheetOpen(false)}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{needsApproval ? 'Request booking' : 'Confirm booking'}</Text>
            <TouchableOpacity onPress={() => setSheetOpen(false)} hitSlop={8} disabled={book.isPending}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
            <View>
              <Text style={styles.sheetAmenity}>{amenity.name}</Text>
              {range?.startAt && range.endAt ? <Text style={styles.sheetWhen}>{fmtRange(range.startAt, range.endAt)}</Text> : null}
            </View>

            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>Guests</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setGuests((g) => Math.max(0, g - 1))} accessibilityLabel="Fewer guests">
                  <Ionicons name="remove" size={18} color={colors.primary} />
                </TouchableOpacity>
                <Text style={styles.stepValue}>{guests}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setGuests((g) => Math.min(500, g + 1))} accessibilityLabel="More guests">
                  <Ionicons name="add" size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Note for the committee (optional)"
              placeholderTextColor={colors.textTertiary}
              maxLength={300}
              multiline
            />

            {amenity.fee ? (
              <Text style={styles.sheetHint}>
                Fee: {inr(amenity.fee)}. Pay the committee directly — they mark it collected.
              </Text>
            ) : null}
            {needsApproval ? (
              <Text style={styles.sheetHint}>The committee will review this request. The slot is held for you meanwhile.</Text>
            ) : null}
            <Text style={styles.sheetHint}>
              You can cancel up to {amenity.cancelBeforeHours} hour{amenity.cancelBeforeHours === 1 ? '' : 's'} before it starts.
            </Text>
          </ScrollView>

          <Button
            label={needsApproval ? 'Send request' : 'Confirm booking'}
            onPress={() => book.mutate()}
            loading={book.isPending}
            fullWidth
          />
        </InlineSheet>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: 120 },
  info: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  infoText: { ...typography.bodyMedium, color: colors.text },
  rules: { ...typography.bodySmall, color: colors.textSecondary },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fact: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sectionLabel: { ...typography.labelMedium, color: colors.textSecondary, marginTop: spacing.sm },
  dates: { gap: spacing.sm, paddingVertical: 2 },
  dateChip: {
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateWeekday: { ...typography.bodySmall, color: colors.textSecondary },
  dateDay: { ...typography.labelMedium, color: colors.text, marginTop: 2 },
  dateTextActive: { color: colors.textInverse },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    width: '31%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  slotSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotDisabled: { backgroundColor: colors.surfaceSecondary, opacity: 0.6 },
  slotMine: { borderColor: colors.primary, backgroundColor: colors.primaryLight, opacity: 1 },
  slotTime: { ...typography.labelMedium, color: colors.text },
  slotTimeSelected: { color: colors.textInverse },
  slotTimeDisabled: { color: colors.textTertiary },
  slotNote: { ...typography.bodySmall, color: colors.textTertiary, fontSize: 11 },
  empty: { ...typography.bodyMedium, color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barLabel: { ...typography.bodySmall, color: colors.textSecondary },
  barValue: { ...typography.labelMedium, color: colors.text },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  sheetAmenity: { ...typography.labelLarge, color: colors.text },
  sheetWhen: { ...typography.bodyMedium, color: colors.textSecondary, marginTop: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperLabel: { ...typography.labelMedium, color: colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...typography.labelLarge, color: colors.text, minWidth: 24, textAlign: 'center' },
  input: {
    ...typography.bodyMedium,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  sheetHint: { ...typography.bodySmall, color: colors.textSecondary },
});
