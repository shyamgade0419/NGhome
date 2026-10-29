/**
 * Deliveries for my flat. Two things live here: parcels the gate is holding for
 * me, and the instructions I gave the gate ("send the delivery up" or "leave it
 * at the gate"). The server decides what an instruction does at the gate; this
 * screen only records what I want and shows what happened.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DeliveryExpectation, DeliveryInstruction, Parcel, deliveriesApi } from '@/api/endpoints/deliveries.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { validUntilFrom } from '@/utils/visitors';
import {
  COMPANIES, DELIVERY_DURATIONS, EXPECTATION_STATE, INSTRUCTIONS, PARCEL_STATUS, canCancel, expectationSummary, isHeld, parcelTimeline,
} from '@/utils/deliveries';
import { colors, radius, spacing, typography } from '@/theme';

type Tab = 'parcels' | 'instructions';

function ParcelCard({ parcel }: { parcel: Parcel }) {
  const status = PARCEL_STATUS[parcel.status];
  const waiting = isHeld(parcel);
  return (
    <Card style={[styles.card, waiting && styles.waiting]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{parcel.courier}</Text>
          {parcel.recipientName || parcel.note ? (
            <Text style={styles.meta}>{[parcel.recipientName && `For ${parcel.recipientName}`, parcel.note].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
        <StatusBadge size="sm" label={status.label} variant={status.variant} />
      </View>
      <Text style={styles.time}>{parcelTimeline(parcel)}</Text>
      {waiting && <Text style={styles.hint}>Collect it from the gate.</Text>}
      {parcel.status === 'COLLECTED' && parcel.collectedByName ? <Text style={styles.time}>Taken by {parcel.collectedByName}</Text> : null}
    </Card>
  );
}

function InstructionCard({ item, onCancel, busy }: { item: DeliveryExpectation; onCancel: () => void; busy: boolean }) {
  const status = EXPECTATION_STATE[item.state];
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.company}</Text>
          <Text style={styles.meta}>{expectationSummary(item)}</Text>
        </View>
        <StatusBadge size="sm" label={status.label} variant={status.variant} />
      </View>
      {item.note ? <Text style={styles.time}>{item.note}</Text> : null}
      {canCancel(item) && <Button label="Cancel" variant="outline" onPress={onCancel} loading={busy} fullWidth style={{ marginTop: spacing.sm }} />}
    </Card>
  );
}

export default function DeliveriesScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('parcels');
  const [open, setOpen] = useState(false);

  const parcels = useQuery({ queryKey: ['my-parcels'], queryFn: deliveriesApi.myParcels, refetchInterval: 20_000 });
  const instructions = useQuery({ queryKey: ['my-delivery-instructions'], queryFn: deliveriesApi.myExpectations });
  const active = tab === 'parcels' ? parcels : instructions;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-parcels'] });
    qc.invalidateQueries({ queryKey: ['my-delivery-instructions'] });
  };

  const cancel = useMutation({
    mutationFn: (id: string) => deliveriesApi.cancelExpectation(id),
    onSuccess: refresh,
    onError: (e) => {
      refresh();
      Alert.alert('Could not cancel', apiErrorMessage(e, 'Please try again.'));
    },
  });

  // ── new instruction ──────────────────────────────────────────────────────
  const [company, setCompany] = useState('');
  const [instruction, setInstruction] = useState<DeliveryInstruction>('ALLOW_ENTRY');
  const [hours, setHours] = useState(12);
  const [note, setNote] = useState('');

  const create = useMutation({
    mutationFn: () =>
      deliveriesApi.expect({
        company: company.trim(),
        instruction,
        note: note.trim() || undefined,
        validUntil: validUntilFrom(new Date(), hours),
      }),
    onSuccess: () => {
      refresh();
      setOpen(false);
      setCompany('');
      setNote('');
      setInstruction('ALLOW_ENTRY');
      setHours(12);
      setTab('instructions');
    },
    onError: (e) => Alert.alert('Could not save', apiErrorMessage(e, 'Please try again.')),
  });

  const heldCount = (parcels.data ?? []).filter(isHeld).length;
  const chosen = INSTRUCTIONS.find((i) => i.value === instruction)!;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Deliveries"
          subtitle={heldCount > 0 ? `${heldCount} waiting at the gate` : 'Parcels and delivery instructions'}
          showBack
          rightAction={
            <TouchableOpacity onPress={() => setOpen(true)} hitSlop={8} accessibilityLabel="A delivery is coming">
              <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
            </TouchableOpacity>
          }
        />

        <View style={styles.tabs}>
          {([['parcels', 'Parcels'], ['instructions', 'Instructions']] as [Tab, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)} accessibilityRole="button" accessibilityState={{ selected: tab === key }}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {active.isLoading ? (
          <LoadingState message="Loading…" />
        ) : active.isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load" description="Check your connection and try again." actionLabel="Try again" onAction={() => active.refetch()} />
        ) : tab === 'parcels' ? (
          <FlatList
            data={parcels.data ?? []}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={parcels.isRefetching} onRefresh={() => parcels.refetch()} />}
            renderItem={({ item }) => <ParcelCard parcel={item} />}
            ListEmptyComponent={
              <EmptyState icon="cube-outline" title="No parcels yet" description="When the gate receives a parcel for your flat, you are told and it appears here until you collect it." />
            }
          />
        ) : (
          <FlatList
            data={instructions.data ?? []}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={instructions.isRefetching} onRefresh={() => instructions.refetch()} />}
            renderItem={({ item }) => <InstructionCard item={item} busy={cancel.isPending && cancel.variables === item.id} onCancel={() => cancel.mutate(item.id)} />}
            ListEmptyComponent={
              <EmptyState
                icon="bicycle-outline"
                title="No instructions"
                description="Expecting a delivery? Tell the gate whether to send the delivery person up or keep the parcel at the gate."
                actionLabel="A delivery is coming"
                onAction={() => setOpen(true)}
              />
            }
          />
        )}
      </View>

      <InlineSheet visible={open} onRequestClose={() => !create.isPending && setOpen(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>A delivery is coming</Text>
          <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10} disabled={create.isPending} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md }}>
          <Text style={styles.label}>From</Text>
          <View style={styles.chips}>
            {COMPANIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, company === c && styles.chipActive]} onPress={() => setCompany(c)}>
                <Text style={[styles.chipText, company === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} value={company} onChangeText={setCompany} placeholder="Or type who is delivering" placeholderTextColor={colors.textTertiary} maxLength={60} />

          <Text style={styles.label}>What should the gate do?</Text>
          <View style={styles.chips}>
            {INSTRUCTIONS.map((i) => (
              <TouchableOpacity key={i.value} style={[styles.chip, instruction === i.value && styles.chipActive]} onPress={() => setInstruction(i.value)}>
                <Text style={[styles.chipText, instruction === i.value && styles.chipTextActive]}>{i.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>{chosen.hint}</Text>

          <Text style={styles.label}>For the next</Text>
          <View style={styles.chips}>
            {DELIVERY_DURATIONS.map((d) => (
              <TouchableOpacity key={d.hours} style={[styles.chip, hours === d.hours && styles.chipActive]} onPress={() => setHours(d.hours)}>
                <Text style={[styles.chipText, hours === d.hours && styles.chipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Note for the guard (optional)" placeholderTextColor={colors.textTertiary} maxLength={200} />
        </ScrollView>
        <Button label="Tell the gate" onPress={() => create.mutate()} loading={create.isPending} disabled={company.trim().length < 2} fullWidth style={{ marginTop: spacing.md }} />
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
  waiting: { borderWidth: 1.5, borderColor: colors.warning },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
});
