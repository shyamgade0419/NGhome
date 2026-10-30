/**
 * The gate. What a guard needs and nothing else: who is waiting, who is
 * inside, a way to register a visitor, and a way to check an invitation code.
 *
 * Everything here is advice from the server's point of view: the server
 * decides whether a visitor may be let in and whether a code is good, and it
 * recognises a retried request, so a double tap or a flaky connection cannot
 * create a second entry or spend a code twice.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, RefreshControl, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GateFlat, VisitorEntry, VisitorType, visitorsApi } from '@/api/endpoints/visitors.api';
import { deliveriesApi } from '@/api/endpoints/deliveries.api';
import { ParcelsPanel } from '@/components/gate/ParcelsPanel';
import { HelpPanel } from '@/components/gate/HelpPanel';
import { VehiclePanel } from '@/components/gate/VehiclePanel';
import { StaffPanel } from '@/components/gate/StaffPanel';
import { instructionsForFlat } from '@/utils/deliveries';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  ENTRY_STATUS, VISITOR_TYPES, canCheckOut, canLetIn, formatCodeInput, isCompleteCode, newRequestId, phoneForApi, tidyVehicle, timeline, visitorTypeLabel,
} from '@/utils/visitors';
import { colors, radius, spacing, typography } from '@/theme';

type CodeResult = { kind: 'ok'; entry: VisitorEntry } | { kind: 'error'; message: string } | null;

/** A response means the server answered (so the attempt is settled); no response means the network failed and the same attempt may be retried. */
const reachedServer = (err: unknown): boolean => !!(err as { response?: unknown })?.response;

function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[styles.chip, value === o.value && styles.chipActive]}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
        >
          <Text style={[styles.chipText, value === o.value && styles.chipTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function EntryCard({ entry, onLetIn, onCheckOut, busy }: { entry: VisitorEntry; onLetIn: () => void; onCheckOut: () => void; busy: boolean }) {
  const status = ENTRY_STATUS[entry.status];
  return (
    <Card style={styles.entry}>
      <View style={styles.entryTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.entryName} numberOfLines={1}>{entry.visitorName}</Text>
          <Text style={styles.entryMeta}>
            <Text style={styles.flatCode}>{entry.flatCode ?? '—'}</Text> · {visitorTypeLabel(entry.visitorType)}
            {entry.vehicleNumber ? ` · ${entry.vehicleNumber}` : ''}
          </Text>
        </View>
        <StatusBadge size="sm" label={status.label} variant={status.variant} />
      </View>
      <Text style={styles.entryTime}>{timeline(entry)}</Text>
      {entry.purpose ? <Text style={styles.entryTime}>{entry.purpose}</Text> : null}

      {canLetIn(entry) && <Button label="Let in" onPress={onLetIn} loading={busy} fullWidth style={styles.action} />}
      {canCheckOut(entry) && <Button label="Mark as left" variant="outline" onPress={onCheckOut} loading={busy} fullWidth style={styles.action} />}
      {entry.status === 'PENDING_APPROVAL' && <Text style={styles.note}>The resident has been asked. Do not let them in yet.</Text>}
      {entry.status === 'REJECTED' && <Text style={[styles.note, { color: colors.error }]}>The resident declined. Do not let them in.</Text>}
      {entry.status === 'EXPIRED' && <Text style={styles.note}>No answer in time. Register them again, or call the resident.</Text>}
    </Card>
  );
}

export default function GateScreen() {
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const [search, setSearch] = useState('');
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [mode, setMode] = useState<'visitors' | 'parcels' | 'help' | 'vehicles' | 'staff'>('visitors');

  const list = useQuery({
    queryKey: ['gate-visitors', search.trim()],
    queryFn: () => visitorsApi.gateList(search.trim() || undefined),
    refetchInterval: 10_000,
  });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['gate-visitors'] }), [qc]);

  const checkIn = useMutation({
    mutationFn: (id: string) => visitorsApi.checkIn(id),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Could not let them in', apiErrorMessage(e, 'Please try again.')),
  });
  const checkOut = useMutation({
    mutationFn: (id: string) => visitorsApi.checkOut(id),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Could not update', apiErrorMessage(e, 'Please try again.')),
  });
  const busyId = (checkIn.isPending && checkIn.variables) || (checkOut.isPending && checkOut.variables) || null;

  // ── walk-in ──────────────────────────────────────────────────────────────
  const [flatSearch, setFlatSearch] = useState('');
  const [flat, setFlat] = useState<GateFlat | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<VisitorType>('GUEST');
  const [vehicle, setVehicle] = useState('');
  const [purpose, setPurpose] = useState('');
  const walkInRequestId = useRef(newRequestId());

  const flats = useQuery({
    queryKey: ['gate-flats', flatSearch.trim()],
    queryFn: () => visitorsApi.gateFlats(flatSearch.trim() || undefined),
    enabled: walkInOpen && !flat,
    staleTime: 60_000,
  });

  // What the picked flat has said about deliveries, so a "leave it at the gate" is seen before the visitor is sent up.
  const expected = useQuery({ queryKey: ['gate-expected'], queryFn: deliveriesApi.expected, enabled: walkInOpen && type === 'DELIVERY' && !!flat, staleTime: 30_000 });
  const flatNotes = type === 'DELIVERY' ? instructionsForFlat(expected.data ?? [], flat?.id) : [];

  const resetWalkIn = () => {
    setFlatSearch(''); setFlat(null); setName(''); setPhone(''); setType('GUEST'); setVehicle(''); setPurpose('');
    walkInRequestId.current = newRequestId();
  };

  const walkIn = useMutation({
    mutationFn: () =>
      visitorsApi.walkIn({
        flatId: flat!.id,
        visitorName: name.trim(),
        visitorPhone: phoneForApi(phone),
        visitorType: type,
        vehicleNumber: vehicle.trim() || undefined,
        purpose: purpose.trim() || undefined,
        clientRequestId: walkInRequestId.current,
      }),
    onSuccess: (res) => {
      const flatCode = flat?.flatCode;
      setWalkInOpen(false);
      resetWalkIn();
      refresh();
      if (res.expectedDelivery) {
        Alert.alert('Expected delivery', `${flatCode} said to send ${res.expectedDelivery} up. Press "Let in" on the visitor.`);
      } else if (res.entry.status === 'PENDING_APPROVAL') {
        Alert.alert(
          res.notifiedResidents > 0 ? 'Resident asked' : 'No one could be asked',
          res.notifiedResidents > 0
            ? `${res.notifiedResidents} resident${res.notifiedResidents === 1 ? '' : 's'} of ${flatCode} ${res.notifiedResidents === 1 ? 'has' : 'have'} been notified. Wait for their answer.`
            : `No active resident of ${flatCode} could be notified. Please call them, or ask the committee.`,
        );
      }
    },
    onError: (e) => {
      // A reply from the server settles this attempt; a dropped connection does not, so the same id is kept and a retry is safe.
      if (reachedServer(e)) walkInRequestId.current = newRequestId();
      Alert.alert('Could not register', apiErrorMessage(e, 'Check the connection and try again.'));
    },
  });

  const canRegister = !!flat && name.trim().length >= 2 && !walkIn.isPending;

  // ── code ─────────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [codeResult, setCodeResult] = useState<CodeResult>(null);
  const codeRequestId = useRef(newRequestId());

  const scan = useMutation({
    mutationFn: () => visitorsApi.scan(code, codeRequestId.current),
    onSuccess: (res) => {
      codeRequestId.current = newRequestId();
      setCodeResult({ kind: 'ok', entry: res.entry });
      refresh();
    },
    onError: (e) => {
      if (reachedServer(e)) codeRequestId.current = newRequestId();
      setCodeResult({ kind: 'error', message: apiErrorMessage(e, 'Could not check the code. Check the connection and try again.') });
    },
  });

  const closeCode = () => {
    setCodeOpen(false);
    setCode('');
    setCodeResult(null);
    codeRequestId.current = newRequestId();
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need to sign in again to use the gate.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);

  const entries = list.data ?? [];
  const inside = useMemo(() => entries.filter((e) => e.status === 'CHECKED_IN').length, [entries]);
  const waiting = useMemo(() => entries.filter((e) => e.status === 'PENDING_APPROVAL').length, [entries]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Gate</Text>
          <Text style={styles.subtitle}>
            {user?.firstName ? `${user.firstName} · ` : ''}{inside} inside · {waiting} waiting
          </Text>
        </View>
        <TouchableOpacity onPress={confirmSignOut} hitSlop={10} accessibilityLabel="Sign out">
          <Ionicons name="log-out-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.modes}>
        {([['visitors', 'Visitors'], ['parcels', 'Parcels'], ['help', 'Help'], ['vehicles', 'Vehicles'], ['staff', 'Staff']] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.mode, mode === key && styles.modeActive]} onPress={() => setMode(key)} accessibilityRole="button" accessibilityState={{ selected: mode === key }}>
            <Text style={[styles.modeText, mode === key && styles.modeTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {mode === 'parcels' ? <ParcelsPanel /> : mode === 'help' ? <HelpPanel /> : mode === 'vehicles' ? <VehiclePanel /> : mode === 'staff' ? <StaffPanel /> : (<>
      <View style={styles.bigButtons}>
        <Button label="New visitor" icon={<Ionicons name="person-add-outline" size={18} color={colors.textInverse} />} onPress={() => setWalkInOpen(true)} style={{ flex: 1 }} />
        <Button label="Enter code" variant="outline" icon={<Ionicons name="keypad-outline" size={18} color={colors.primary} />} onPress={() => setCodeOpen(true)} style={{ flex: 1 }} />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, vehicle or flat"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {list.isLoading ? (
        <LoadingState message="Loading the gate…" />
      ) : list.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Can't reach the server" description="Check the connection. Nothing you do here is lost: it just can't be sent until the network is back." actionLabel="Try again" onAction={() => list.refetch()} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />}
          renderItem={({ item }) => (
            <EntryCard
              entry={item}
              busy={busyId === item.id}
              onLetIn={() => checkIn.mutate(item.id)}
              onCheckOut={() => checkOut.mutate(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="shield-checkmark-outline" title={search ? 'No match' : 'No visitors yet today'} description={search ? 'Try another name, phone, vehicle or flat.' : 'Register a visitor, or enter an invitation code, and they appear here.'} />
          }
        />
      )}
      </>)}

      {/* New visitor */}
      <InlineSheet visible={walkInOpen} onRequestClose={() => !walkIn.isPending && setWalkInOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New visitor</Text>
            <TouchableOpacity onPress={() => setWalkInOpen(false)} hitSlop={10} disabled={walkIn.isPending}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md }}>
            <Text style={styles.label}>Going to flat</Text>
            {flat ? (
              <TouchableOpacity style={styles.picked} onPress={() => setFlat(null)} accessibilityRole="button" accessibilityLabel="Change flat">
                <Text style={styles.pickedText}>{flat.flatCode}{flat.buildingName ? ` · ${flat.buildingName}` : ''}</Text>
                <Text style={styles.change}>Change</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput style={styles.input} value={flatSearch} onChangeText={setFlatSearch} placeholder="Type a flat number, e.g. A-403" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" autoCorrect={false} />
                <View style={styles.flatList}>
                  {(flats.data ?? []).map((f) => (
                    <TouchableOpacity key={f.id} style={styles.flatRow} onPress={() => setFlat(f)}>
                      <Text style={styles.flatRowText}>{f.flatCode}</Text>
                      {f.buildingName ? <Text style={styles.flatRowSub}>{f.buildingName}</Text> : null}
                    </TouchableOpacity>
                  ))}
                  {flats.isFetched && (flats.data ?? []).length === 0 ? <Text style={styles.note}>No flat matches.</Text> : null}
                </View>
              </>
            )}

            <Text style={styles.label}>Visitor</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.textTertiary} maxLength={100} />
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone (optional)" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" maxLength={20} />
            <Chips options={VISITOR_TYPES} value={type} onChange={setType} />
            {flatNotes.map((n) => (
              <View key={n.id} style={styles.deliveryNote}>
                <Ionicons name={n.instruction === 'LEAVE_AT_GATE' ? 'hand-left-outline' : 'checkmark-circle-outline'} size={18} color={colors.warning} />
                <Text style={styles.deliveryNoteText}>
                  {n.instruction === 'LEAVE_AT_GATE'
                    ? `${flat?.flatCode} asked for ${n.company} deliveries to be left at the gate. Record a parcel instead.`
                    : `${flat?.flatCode} said to send ${n.company} up. They will be approved without asking.`}
                </Text>
              </View>
            ))}
            <TextInput style={styles.input} value={vehicle} onChangeText={(v) => setVehicle(tidyVehicle(v))} placeholder="Vehicle number (optional)" placeholderTextColor={colors.textTertiary} autoCapitalize="characters" />
            <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="Purpose (optional)" placeholderTextColor={colors.textTertiary} maxLength={200} />
          </ScrollView>
          <Button label="Ask the resident" onPress={() => walkIn.mutate()} loading={walkIn.isPending} disabled={!canRegister} fullWidth style={{ marginTop: spacing.md }} />
        </KeyboardAvoidingView>
      </InlineSheet>

      {/* Invitation code */}
      <InlineSheet visible={codeOpen} onRequestClose={closeCode}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Invitation code</Text>
          <TouchableOpacity onPress={closeCode} hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {codeResult?.kind === 'ok' ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.resultBox, { backgroundColor: colors.successLight }]}>
              <Ionicons name="checkmark-circle" size={36} color={colors.success} />
              <Text style={styles.resultTitle}>Let them in</Text>
              <Text style={styles.resultLine}>{codeResult.entry.visitorName}</Text>
              <Text style={styles.resultLine}>Flat {codeResult.entry.flatCode}</Text>
            </View>
            <Button label="Done" onPress={closeCode} fullWidth />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.note}>Ask the visitor for the 8-character code their host sent them.</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => { setCode(formatCodeInput(t)); setCodeResult(null); }}
              placeholder="XXXX-XXXX"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              autoFocus
            />
            {codeResult?.kind === 'error' && (
              <View style={[styles.resultBox, { backgroundColor: colors.errorLight }]}>
                <Ionicons name="close-circle" size={30} color={colors.error} />
                <Text style={[styles.resultTitle, { color: colors.error }]}>Do not let them in</Text>
                <Text style={styles.resultLine}>{codeResult.message}</Text>
              </View>
            )}
            <Button label="Check code" onPress={() => scan.mutate()} loading={scan.isPending} disabled={!isCompleteCode(code)} fullWidth />
          </View>
        )}
      </InlineSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...typography.headingMedium, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  modes: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingTop: spacing.md },
  mode: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  modeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { ...typography.labelLarge, color: colors.textSecondary },
  modeTextActive: { color: colors.textInverse },
  deliveryNote: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningLight },
  deliveryNoteText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  bigButtons: { flexDirection: 'row', gap: spacing.md, padding: spacing.base },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.base, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, paddingVertical: spacing.md },
  list: { padding: spacing.base, gap: spacing.md },
  entry: { gap: spacing.xs },
  entryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryName: { ...typography.headingSmall, color: colors.text },
  entryMeta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  flatCode: { fontWeight: '700', color: colors.text },
  entryTime: { ...typography.bodySmall, color: colors.textTertiary },
  action: { marginTop: spacing.sm },
  note: { ...typography.bodySmall, color: colors.textSecondary },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  codeInput: { ...typography.headingMedium, textAlign: 'center', letterSpacing: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  picked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  pickedText: { ...typography.labelLarge, color: colors.primary },
  change: { ...typography.labelMedium, color: colors.primary },
  flatList: { gap: 6 },
  flatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  flatRowText: { ...typography.labelLarge, color: colors.text },
  flatRowSub: { ...typography.bodySmall, color: colors.textTertiary },
  resultBox: { alignItems: 'center', gap: 4, padding: spacing.lg, borderRadius: radius.lg },
  resultTitle: { ...typography.headingSmall, color: colors.success },
  resultLine: { ...typography.bodyMedium, color: colors.text, textAlign: 'center' },
});
