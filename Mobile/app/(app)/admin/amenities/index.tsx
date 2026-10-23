/**
 * Committee — manage bookable spaces. Rule changes apply to new bookings only;
 * anything residents have already booked is left exactly as it was.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, Switch, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Amenity, AmenityPayload, amenitiesApi, apiErrorMessage } from '@/api/endpoints/amenities.api';
import { AmenityForm, EMPTY_FORM, buildAmenityPayload, formFromAmenity } from '@/utils/amenity-form';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { fmtMinutes } from '@/utils/amenity-time';
import { inr } from '@/utils/format';
import { colors, spacing, typography, radius } from '@/theme';

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, input.multiline && styles.inputMultiline]}
        placeholderTextColor={colors.textTertiary}
        {...input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export default function ManageAmenitiesScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Amenity | 'new' | null>(null);
  const [form, setForm] = useState<AmenityForm>(EMPTY_FORM);
  const set = <K extends keyof AmenityForm>(key: K, value: AmenityForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['amenities-admin'],
    queryFn: () => amenitiesApi.list(true),
  });

  const open = (target: Amenity | 'new') => {
    setForm(target === 'new' ? EMPTY_FORM : formFromAmenity(target));
    setEditing(target);
  };
  const close = useCallback(() => setEditing(null), []);

  const save = useMutation({
    mutationFn: (payload: AmenityPayload) =>
      editing === 'new' || editing === null ? amenitiesApi.create(payload) : amenitiesApi.update(editing.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['amenities'] });
      qc.invalidateQueries({ queryKey: ['amenities-admin'] });
      close();
    },
    onError: (err) => Alert.alert('Could not save', apiErrorMessage(err, 'Something went wrong. Please try again.')),
  });

  const submit = () => {
    const result = buildAmenityPayload(form);
    if (!result.ok) {
      Alert.alert('Check the form', result.error);
      return;
    }
    save.mutate(result.payload);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Manage amenities"
          subtitle="Spaces residents can book"
          showBack
          rightAction={
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => router.push('/(app)/admin/amenities/bookings' as any)} hitSlop={8} accessibilityLabel="Bookings">
                <Ionicons name="calendar-outline" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => open('new')} hitSlop={8} accessibilityLabel="Add amenity">
                <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
              </TouchableOpacity>
            </View>
          }
        />

        {isLoading ? (
          <LoadingState message="Loading amenities…" />
        ) : (
          <FlatList
            data={data ?? []}
            keyExtractor={(a) => a.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
            renderItem={({ item }) => (
              <Card onPress={() => open(item)} style={[styles.card, !item.isActive && { opacity: 0.6 }]}>
                <View style={styles.rowTop}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {!item.isActive && <StatusBadge size="sm" label="Hidden" variant="neutral" />}
                </View>
                <Text style={styles.meta}>
                  {fmtMinutes(item.opensAtMin)} – {fmtMinutes(item.closesAtMin)} · {item.slotMinutes} min slots
                </Text>
                <Text style={styles.meta}>
                  {item.bookingMode === 'INSTANT' ? 'Instant booking' : 'Needs approval'} · {item.fee ? `${inr(item.fee)} per booking` : 'Free'}
                </Text>
              </Card>
            )}
            ListEmptyComponent={
              <EmptyState
                icon="calendar-outline"
                title="No amenities yet"
                description="Tap + to add your clubhouse, hall, court or gym. Residents can book it as soon as you save."
              />
            }
          />
        )}

        <InlineSheet visible={editing !== null} onRequestClose={() => !save.isPending && close()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{editing === 'new' ? 'New amenity' : 'Edit amenity'}</Text>
            <TouchableOpacity onPress={close} hitSlop={8} disabled={save.isPending}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
            <Field label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Clubhouse" maxLength={80} />
            <Field label="Description" value={form.description} onChangeText={(v) => set('description', v)} placeholder="Optional" multiline maxLength={1000} />
            <Field label="House rules" value={form.rules} onChangeText={(v) => set('rules', v)} placeholder="Shown to residents before they book" multiline maxLength={2000} />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Booking</Text>
              <View style={styles.segment}>
                {(['INSTANT', 'NEEDS_APPROVAL'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.segmentBtn, form.bookingMode === mode && styles.segmentActive]}
                    onPress={() => set('bookingMode', mode)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: form.bookingMode === mode }}
                  >
                    <Text style={[styles.segmentText, form.bookingMode === mode && styles.segmentTextActive]}>
                      {mode === 'INSTANT' ? 'Instant' : 'Needs approval'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field label="Opens" value={form.opens} onChangeText={(v) => set('opens', v)} placeholder="06:00" keyboardType="numbers-and-punctuation" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Closes" value={form.closes} onChangeText={(v) => set('closes', v)} placeholder="22:00" keyboardType="numbers-and-punctuation" />
              </View>
            </View>
            <Text style={styles.hint}>24-hour India time, like 06:00 and 22:00.</Text>

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field label="Slot length (min)" value={form.slotMinutes} onChangeText={(v) => set('slotMinutes', v)} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Slots per booking" value={form.maxSlots} onChangeText={(v) => set('maxSlots', v)} keyboardType="number-pad" />
              </View>
            </View>

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field label="Bookings per slot" value={form.capacity} onChangeText={(v) => set('capacity', v)} keyboardType="number-pad" hint="1 = one flat at a time" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Days ahead" value={form.advanceDays} onChangeText={(v) => set('advanceDays', v)} keyboardType="number-pad" />
              </View>
            </View>

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field label="Monthly limit per flat" value={form.monthlyCap} onChangeText={(v) => set('monthlyCap', v)} keyboardType="number-pad" placeholder="None" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Cancel notice (hours)" value={form.cancelHours} onChangeText={(v) => set('cancelHours', v)} keyboardType="number-pad" />
              </View>
            </View>

            <Field label="Fee per booking (₹)" value={form.fee} onChangeText={(v) => set('fee', v)} keyboardType="decimal-pad" placeholder="Free" hint="You mark it collected into an account once you receive it." />

            {editing !== 'new' && (
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Available to book</Text>
                  <Text style={styles.hint}>Turn off to hide it from residents. Existing bookings are kept.</Text>
                </View>
                <Switch value={form.isActive} onValueChange={(v) => set('isActive', v)} trackColor={{ true: colors.primary }} />
              </View>
            )}
          </ScrollView>

          <Button label={editing === 'new' ? 'Add amenity' : 'Save changes'} onPress={submit} loading={save.isPending} fullWidth />
        </InlineSheet>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { ...typography.labelLarge, color: colors.text, flex: 1 },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  field: { gap: 4 },
  fieldLabel: { ...typography.labelMedium, color: colors.text },
  hint: { ...typography.bodySmall, color: colors.textTertiary },
  input: {
    ...typography.bodyMedium,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  pair: { flexDirection: 'row', gap: spacing.md },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { ...typography.labelMedium, color: colors.text },
  segmentTextActive: { color: colors.textInverse },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
