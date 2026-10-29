/**
 * The gate's parcels: what residents have told the gate about deliveries, the
 * parcels being held, and the three things a guard does with a parcel (record
 * it, hand it over, send it back). The server recognises a retried "record"
 * by its request id, so a double tap or a dropped connection cannot create a
 * second parcel or a second set of notifications.
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, RefreshControl, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Parcel, deliveriesApi } from '@/api/endpoints/deliveries.api';
import { GateFlat, visitorsApi } from '@/api/endpoints/visitors.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { COMPANIES, PARCEL_STATUS, expectationSummary, isHeld, parcelTimeline } from '@/utils/deliveries';
import { newRequestId } from '@/utils/visitors';
import { colors, radius, spacing, typography } from '@/theme';

/** A response means the server answered (so the attempt is settled); no response means the network failed and the same attempt may be retried. */
const reachedServer = (err: unknown): boolean => !!(err as { response?: unknown })?.response;

export function ParcelsPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [handing, setHanding] = useState<Parcel | null>(null);
  const [takenBy, setTakenBy] = useState('');

  const list = useQuery({ queryKey: ['gate-parcels', search.trim()], queryFn: () => deliveriesApi.gateParcels(search.trim() || undefined), refetchInterval: 15_000 });
  const expected = useQuery({ queryKey: ['gate-expected'], queryFn: deliveriesApi.expected, refetchInterval: 60_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['gate-parcels'] });

  // ── record a parcel ──────────────────────────────────────────────────────
  const [flatSearch, setFlatSearch] = useState('');
  const [flat, setFlat] = useState<GateFlat | null>(null);
  const [courier, setCourier] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const requestId = useRef(newRequestId());

  const flats = useQuery({
    queryKey: ['gate-flats', flatSearch.trim()],
    queryFn: () => visitorsApi.gateFlats(flatSearch.trim() || undefined),
    enabled: recordOpen && !flat,
    staleTime: 60_000,
  });

  const resetRecord = () => {
    setFlatSearch(''); setFlat(null); setCourier(''); setRecipient(''); setNote('');
    requestId.current = newRequestId();
  };

  const record = useMutation({
    mutationFn: () =>
      deliveriesApi.receive({
        flatId: flat!.id,
        courier: courier.trim(),
        recipientName: recipient.trim() || undefined,
        note: note.trim() || undefined,
        clientRequestId: requestId.current,
      }),
    onSuccess: (res) => {
      const flatCode = flat?.flatCode;
      setRecordOpen(false);
      resetRecord();
      refresh();
      Alert.alert(
        res.notifiedResidents > 0 ? 'Resident told' : 'No one could be told',
        res.notifiedResidents > 0
          ? `${flatCode} has been told the parcel is waiting at the gate.`
          : `No active resident of ${flatCode} could be notified. Please let them know.`,
      );
    },
    onError: (e) => {
      if (reachedServer(e)) requestId.current = newRequestId();
      Alert.alert('Could not record', apiErrorMessage(e, 'Check the connection and try again.'));
    },
  });

  const handOver = useMutation({
    mutationFn: () => deliveriesApi.handOver(handing!.id, takenBy.trim() || undefined),
    onSuccess: () => {
      setHanding(null);
      setTakenBy('');
      refresh();
    },
    onError: (e) => {
      refresh();
      Alert.alert('Could not hand over', apiErrorMessage(e, 'Please try again.'));
    },
  });

  const sendBack = useMutation({
    mutationFn: (id: string) => deliveriesApi.returnParcel(id),
    onSuccess: refresh,
    onError: (e) => {
      refresh();
      Alert.alert('Could not update', apiErrorMessage(e, 'Please try again.'));
    },
  });
  const confirmReturn = (p: Parcel) =>
    Alert.alert(`Send ${p.courier} parcel back?`, `It is for ${p.flatCode}. Do this only when the courier is taking it away.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Send back', style: 'destructive', onPress: () => sendBack.mutate(p.id) },
    ]);

  const closeHandOver = () => {
    if (handOver.isPending) return;
    setHanding(null);
    setTakenBy('');
  };

  const live = expected.data ?? [];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bigButtons}>
        <Button label="Record a parcel" icon={<Ionicons name="cube-outline" size={18} color={colors.textInverse} />} onPress={() => setRecordOpen(true)} fullWidth />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search courier, name or flat" placeholderTextColor={colors.textTertiary} autoCorrect={false} returnKeyType="search" />
      </View>

      {list.isLoading ? (
        <LoadingState message="Loading parcels…" />
      ) : list.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Can't reach the server" description="Check the connection and try again." actionLabel="Try again" onAction={() => list.refetch()} />
      ) : (
        <FlatList
          data={list.data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />}
          ListHeaderComponent={
            live.length > 0 ? (
              <Card style={styles.expectedBox}>
                <Text style={styles.expectedTitle}>Residents are expecting</Text>
                {live.map((e) => (
                  <Text key={e.id} style={styles.expectedLine}>
                    <Text style={styles.flatCode}>{e.flatCode}</Text> · {expectationSummary(e)}
                    {e.note ? ` · ${e.note}` : ''}
                  </Text>
                ))}
              </Card>
            ) : null
          }
          renderItem={({ item }) => {
            const status = PARCEL_STATUS[item.status];
            const busy = (handOver.isPending && handing?.id === item.id) || (sendBack.isPending && sendBack.variables === item.id);
            return (
              <Card style={styles.parcel}>
                <View style={styles.top}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.courier}</Text>
                    <Text style={styles.meta}>
                      <Text style={styles.flatCode}>{item.flatCode ?? '—'}</Text>
                      {item.recipientName ? ` · For ${item.recipientName}` : ''}
                      {item.note ? ` · ${item.note}` : ''}
                    </Text>
                  </View>
                  <StatusBadge size="sm" label={status.label} variant={status.variant} />
                </View>
                <Text style={styles.time}>{parcelTimeline(item)}</Text>
                {item.status === 'COLLECTED' && item.collectedByName ? <Text style={styles.time}>Taken by {item.collectedByName}</Text> : null}
                {isHeld(item) && (
                  <View style={styles.actions}>
                    <Button label="Hand over" onPress={() => setHanding(item)} loading={busy} style={{ flex: 1 }} />
                    <Button label="Send back" variant="outline" onPress={() => confirmReturn(item)} disabled={busy} style={{ flex: 1 }} />
                  </View>
                )}
              </Card>
            );
          }}
          ListEmptyComponent={
            <EmptyState icon="cube-outline" title={search ? 'No match' : 'No parcels today'} description={search ? 'Try another courier, name or flat.' : 'Record a parcel when one is left at the gate, and the resident is told.'} />
          }
        />
      )}

      {/* Record a parcel */}
      <InlineSheet visible={recordOpen} onRequestClose={() => !record.isPending && setRecordOpen(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Record a parcel</Text>
          <TouchableOpacity onPress={() => setRecordOpen(false)} hitSlop={10} disabled={record.isPending} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md }}>
          <Text style={styles.label}>For flat</Text>
          {flat ? (
            <TouchableOpacity style={styles.picked} onPress={() => setFlat(null)} accessibilityRole="button" accessibilityLabel="Change flat">
              <Text style={styles.pickedText}>{flat.flatCode}{flat.buildingName ? ` · ${flat.buildingName}` : ''}</Text>
              <Text style={styles.change}>Change</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TextInput style={styles.input} value={flatSearch} onChangeText={setFlatSearch} placeholder="Type a flat number, e.g. A-403" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" autoCorrect={false} />
              <View style={{ gap: 6 }}>
                {(flats.data ?? []).map((f) => (
                  <TouchableOpacity key={f.id} style={styles.flatRow} onPress={() => setFlat(f)}>
                    <Text style={styles.flatRowText}>{f.flatCode}</Text>
                    {f.buildingName ? <Text style={styles.flatRowSub}>{f.buildingName}</Text> : null}
                  </TouchableOpacity>
                ))}
                {flats.isFetched && (flats.data ?? []).length === 0 ? <Text style={styles.hint}>No flat matches.</Text> : null}
              </View>
            </>
          )}

          <Text style={styles.label}>From</Text>
          <View style={styles.chips}>
            {COMPANIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, courier === c && styles.chipActive]} onPress={() => setCourier(c)}>
                <Text style={[styles.chipText, courier === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} value={courier} onChangeText={setCourier} placeholder="Or type the courier" placeholderTextColor={colors.textTertiary} maxLength={60} />
          <TextInput style={styles.input} value={recipient} onChangeText={setRecipient} placeholder="Name on the parcel (optional)" placeholderTextColor={colors.textTertiary} maxLength={100} />
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Note, e.g. large box (optional)" placeholderTextColor={colors.textTertiary} maxLength={200} />
        </ScrollView>
        <Button label="Tell the resident" onPress={() => record.mutate()} loading={record.isPending} disabled={!flat || courier.trim().length < 2} fullWidth style={{ marginTop: spacing.md }} />
      </InlineSheet>

      {/* Hand over */}
      <InlineSheet visible={!!handing} onRequestClose={closeHandOver}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Hand over</Text>
          <TouchableOpacity onPress={closeHandOver} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={{ gap: spacing.md }}>
          <Text style={styles.hint}>{handing ? `${handing.courier} parcel for ${handing.flatCode}` : ''}</Text>
          <TextInput style={styles.input} value={takenBy} onChangeText={setTakenBy} placeholder="Who is taking it? (optional)" placeholderTextColor={colors.textTertiary} maxLength={100} autoFocus />
          <Button label="Confirm hand-over" onPress={() => handOver.mutate()} loading={handOver.isPending} fullWidth />
        </View>
      </InlineSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bigButtons: { padding: spacing.base },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.base, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, paddingVertical: spacing.md },
  list: { padding: spacing.base, gap: spacing.md },
  expectedBox: { gap: 4, backgroundColor: colors.warningLight },
  expectedTitle: { ...typography.labelLarge, color: colors.text },
  expectedLine: { ...typography.bodySmall, color: colors.text },
  parcel: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  flatCode: { fontWeight: '700', color: colors.text },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
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
  picked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  pickedText: { ...typography.labelLarge, color: colors.primary },
  change: { ...typography.labelMedium, color: colors.primary },
  flatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  flatRowText: { ...typography.labelLarge, color: colors.text },
  flatRowSub: { ...typography.bodySmall, color: colors.textTertiary },
});
