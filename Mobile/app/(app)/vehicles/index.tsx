/**
 * Vehicles and parking for my flat. Vehicles: what the household has registered, so the gate can
 * tell a resident's vehicle from a stranger's. Parking: the slots the committee has allocated to
 * the flat, and which of the household's vehicles uses each. A number plate can be registered on
 * one flat only; if one already is (say the vehicle changed hands), the committee removes the old
 * record.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MySlot, MyVehicle, VehicleKind, vehiclesApi } from '@/api/endpoints/vehicles.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { MAX_VEHICLES_PER_FLAT, SLOT_FOR_LABEL, VEHICLE_KINDS, formatPlate, isValidPlate, kindLabel, parkedAt, tidyPlate, vehicleSubtitle, vehiclesForSlot } from '@/utils/vehicles';
import { colors, radius, spacing, typography } from '@/theme';

type Tab = 'vehicles' | 'parking';

export default function VehiclesScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('vehicles');
  const vehicles = useQuery({ queryKey: ['my-vehicles'], queryFn: vehiclesApi.mine });
  const slots = useQuery({ queryKey: ['my-slots'], queryFn: vehiclesApi.mySlots });
  const active = tab === 'vehicles' ? vehicles : slots;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-vehicles'] });
    qc.invalidateQueries({ queryKey: ['my-slots'] });
  };

  // ── add a vehicle ────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [plate, setPlate] = useState('');
  const [kind, setKind] = useState<VehicleKind>('CAR');
  const [make, setMake] = useState('');
  const [colour, setColour] = useState('');

  const closeAdd = () => {
    setAddOpen(false);
    setPlate('');
    setKind('CAR');
    setMake('');
    setColour('');
  };

  const add = useMutation({
    mutationFn: () => vehiclesApi.add({ plate: tidyPlate(plate), kind, make: make.trim() || undefined, colour: colour.trim() || undefined }),
    onSuccess: () => {
      refresh();
      closeAdd();
    },
    onError: (e) => Alert.alert('Could not add', apiErrorMessage(e, 'Please try again.')),
  });
  const full = (vehicles.data ?? []).length >= MAX_VEHICLES_PER_FLAT;

  // ── remove ───────────────────────────────────────────────────────────────
  const remove = useMutation({
    mutationFn: (id: string) => vehiclesApi.remove(id),
    onSuccess: refresh,
    onError: (e) => {
      refresh();
      Alert.alert('Could not remove', apiErrorMessage(e, 'Please try again.'));
    },
  });
  const confirmRemove = (v: MyVehicle) =>
    Alert.alert(`Remove ${formatPlate(v.plate)}?`, 'It comes off your list and out of its parking slot. The number can then be registered by anyone.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(v.id) },
    ]);

  // ── which vehicle uses a slot ────────────────────────────────────────────
  const [picking, setPicking] = useState<MySlot | null>(null);
  const assign = useMutation({
    mutationFn: ({ slotId, vehicleId }: { slotId: string; vehicleId: string | null }) => vehiclesApi.assign(slotId, vehicleId),
    onSuccess: () => {
      refresh();
      setPicking(null);
    },
    onError: (e) => Alert.alert('Could not update', apiErrorMessage(e, 'Please try again.')),
  });
  const fits = picking ? vehiclesForSlot(vehicles.data ?? [], picking) : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Vehicles & parking"
          subtitle={`${(vehicles.data ?? []).length} vehicle${(vehicles.data ?? []).length === 1 ? '' : 's'} · ${(slots.data ?? []).length} slot${(slots.data ?? []).length === 1 ? '' : 's'}`}
          showBack
          rightAction={
            <TouchableOpacity onPress={() => (full ? Alert.alert('List is full', `A flat can have ${MAX_VEHICLES_PER_FLAT} vehicles. Remove one first.`) : setAddOpen(true))} hitSlop={8} accessibilityLabel="Add a vehicle">
              <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
            </TouchableOpacity>
          }
        />

        <View style={styles.tabs}>
          {([['vehicles', 'Vehicles'], ['parking', 'Parking']] as [Tab, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)} accessibilityRole="button" accessibilityState={{ selected: tab === key }}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {active.isLoading ? (
          <LoadingState message="Loading…" />
        ) : active.isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load" description="Check your connection and try again." actionLabel="Try again" onAction={() => active.refetch()} />
        ) : tab === 'vehicles' ? (
          <FlatList
            data={vehicles.data ?? []}
            keyExtractor={(v) => v.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={vehicles.isRefetching} onRefresh={() => vehicles.refetch()} />}
            renderItem={({ item }) => (
              <Card style={styles.card}>
                <View style={styles.top}>
                  <Ionicons name={item.kind === 'CAR' ? 'car-outline' : item.kind === 'CYCLE' ? 'bicycle-outline' : 'speedometer-outline'} size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.plate}>{formatPlate(item.plate)}</Text>
                    <Text style={styles.meta}>{kindLabel(item.kind)} · {vehicleSubtitle(item)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => confirmRemove(item)} hitSlop={8} accessibilityLabel={`Remove ${item.plate}`}>
                    <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.time}>{parkedAt(item) ?? 'Not in a parking slot'}</Text>
              </Card>
            )}
            ListEmptyComponent={
              <EmptyState icon="car-outline" title="No vehicles yet" description="Register your car or bike so the gate knows it is yours." actionLabel="Add a vehicle" onAction={() => setAddOpen(true)} />
            }
          />
        ) : (
          <FlatList
            data={slots.data ?? []}
            keyExtractor={(s) => s.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={slots.isRefetching} onRefresh={() => slots.refetch()} />}
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={0.8} onPress={() => setPicking(item)} accessibilityRole="button" accessibilityLabel={`Choose the vehicle for slot ${item.code}`}>
                <Card style={styles.card}>
                  <View style={styles.top}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.plate}>Slot {item.code}</Text>
                      <Text style={styles.meta}>{SLOT_FOR_LABEL[item.slotFor]}{item.area ? ` · ${item.area}` : ''}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </View>
                  <Text style={item.vehiclePlate ? styles.time : styles.hint}>{item.vehiclePlate ? `Used by ${formatPlate(item.vehiclePlate)}` : 'No vehicle set. Tap to choose.'}</Text>
                </Card>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <EmptyState icon="grid-outline" title="No parking slot" description="No slot has been allocated to your flat yet. The committee allocates them." />
            }
          />
        )}
      </View>

      {/* Add a vehicle */}
      <InlineSheet visible={addOpen} onRequestClose={() => !add.isPending && closeAdd()}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Add a vehicle</Text>
          <TouchableOpacity onPress={closeAdd} hitSlop={10} disabled={add.isPending} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }} contentContainerStyle={{ gap: spacing.md }}>
          <TextInput style={[styles.input, styles.plateInput]} value={plate} onChangeText={(t) => setPlate(tidyPlate(t))} placeholder="TS09AB1234" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" autoCorrect={false} maxLength={14} accessibilityLabel="Number plate" />
          <View style={styles.chips}>
            {VEHICLE_KINDS.map((k) => (
              <TouchableOpacity key={k.value} style={[styles.chip, kind === k.value && styles.chipActive]} onPress={() => setKind(k.value)}>
                <Text style={[styles.chipText, kind === k.value && styles.chipTextActive]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} value={make} onChangeText={setMake} placeholder="Make and model (optional)" placeholderTextColor={colors.textTertiary} maxLength={60} />
          <TextInput style={styles.input} value={colour} onChangeText={setColour} placeholder="Colour (optional)" placeholderTextColor={colors.textTertiary} maxLength={30} />
        </ScrollView>
        <Button label="Add vehicle" onPress={() => add.mutate()} loading={add.isPending} disabled={!isValidPlate(plate)} fullWidth style={{ marginTop: spacing.md }} />
      </InlineSheet>

      {/* Which vehicle uses this slot */}
      <InlineSheet visible={!!picking} onRequestClose={() => !assign.isPending && setPicking(null)}>
        {picking && (
          <>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Slot {picking.code}</Text>
                <Text style={styles.meta}>{SLOT_FOR_LABEL[picking.slotFor]}</Text>
              </View>
              <TouchableOpacity onPress={() => setPicking(null)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Which vehicle parks here?</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {fits.length === 0 ? (
                <Text style={styles.hint}>None of your vehicles fit this slot. Add one first.</Text>
              ) : (
                fits.map((v) => (
                  <TouchableOpacity key={v.id} style={[styles.pick, picking.vehicleId === v.id && styles.pickActive]} onPress={() => assign.mutate({ slotId: picking.id, vehicleId: v.id })} disabled={assign.isPending} accessibilityRole="button">
                    <Text style={styles.pickText}>{formatPlate(v.plate)}</Text>
                    <Text style={styles.meta}>{kindLabel(v.kind)}</Text>
                  </TouchableOpacity>
                ))
              )}
              {picking.vehicleId ? (
                <Button label="Clear" variant="outline" onPress={() => assign.mutate({ slotId: picking.id, vehicleId: null })} loading={assign.isPending} fullWidth />
              ) : null}
            </View>
          </>
        )}
      </InlineSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.textInverse },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  plate: { ...typography.headingSmall, color: colors.text, letterSpacing: 1 },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  plateInput: { ...typography.headingMedium, textAlign: 'center', letterSpacing: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pickActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  pickText: { ...typography.labelLarge, color: colors.text, letterSpacing: 1 },
});
