/**
 * The gate's household help: who is inside now, a way to let someone in (by name, or by the
 * pass code they show), and a way to record them leaving. A suspended person is shown but
 * cannot be let in. The server decides, and recognises a retried request by its id, so a
 * double tap or a flaky connection cannot make a second visit.
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GateHelper, GateHelperVisit, HelperRole, helpersApi } from '@/api/endpoints/helpers.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { LoadingState } from '@/components/ui/LoadingState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { canLetIn, helperBadge, isSuspended, roleLabel, visitSpan } from '@/utils/helpers';
import { formatCodeInput, isCompleteCode, newRequestId } from '@/utils/visitors';
import { colors, radius, spacing, typography } from '@/theme';

type CodeResult = { kind: 'ok'; name: string; role: HelperRole; flats: string[]; already: boolean } | { kind: 'error'; message: string } | null;

/** A response means the server answered (so the attempt is settled); no response means the network failed and the same attempt may be retried. */
const reachedServer = (err: unknown): boolean => !!(err as { response?: unknown })?.response;

export function HelpPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);

  const people = useQuery({ queryKey: ['gate-helpers', search.trim()], queryFn: () => helpersApi.gateHelpers(search.trim() || undefined), refetchInterval: 20_000 });
  const visits = useQuery({ queryKey: ['gate-helper-visits'], queryFn: helpersApi.gateVisits, refetchInterval: 15_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['gate-helpers'] });
    qc.invalidateQueries({ queryKey: ['gate-helper-visits'] });
  };

  // One request id per person per attempt: reused after a dropped connection, renewed once the server has answered.
  const ids = useRef<Record<string, string>>({});
  const idFor = (key: string) => (ids.current[key] ??= newRequestId());

  const letIn = useMutation({
    mutationFn: (h: GateHelper) => helpersApi.checkIn(h.id, idFor(h.id)),
    onSuccess: (res, h) => {
      delete ids.current[h.id];
      refresh();
      if (res.alreadyInside) Alert.alert('Already inside', `${h.name} is already inside. Use "Mark as left" when they go.`);
    },
    onError: (e, h) => {
      if (reachedServer(e)) delete ids.current[h.id];
      refresh();
      Alert.alert('Could not let them in', apiErrorMessage(e, 'Check the connection and try again.'));
    },
  });

  const leave = useMutation({
    mutationFn: (v: GateHelperVisit) => helpersApi.checkOut(v.id),
    onSuccess: refresh,
    onError: (e) => Alert.alert('Could not update', apiErrorMessage(e, 'Please try again.')),
  });

  // ── by code ──────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CodeResult>(null);
  const codeId = useRef(newRequestId());

  const scan = useMutation({
    mutationFn: () => helpersApi.scan(code, codeId.current),
    onSuccess: (res) => {
      codeId.current = newRequestId();
      refresh();
      setResult({ kind: 'ok', name: res.helper.name, role: res.helper.role, flats: res.helper.flatCodes, already: res.alreadyInside });
    },
    onError: (e) => {
      if (reachedServer(e)) codeId.current = newRequestId();
      setResult({ kind: 'error', message: apiErrorMessage(e, 'Could not check the code. Check the connection and try again.') });
    },
  });

  const closeCode = () => {
    setCodeOpen(false);
    setCode('');
    setResult(null);
    codeId.current = newRequestId();
  };

  const inside = (visits.data ?? []).filter((v) => v.checkedOutAt === null);
  const busyPerson = letIn.isPending ? letIn.variables?.id : undefined;
  const busyVisit = leave.isPending ? leave.variables?.id : undefined;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bigButtons}>
        <Button label="Enter code" variant="outline" icon={<Ionicons name="keypad-outline" size={18} color={colors.primary} />} onPress={() => setCodeOpen(true)} fullWidth />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search name or flat" placeholderTextColor={colors.textTertiary} autoCorrect={false} returnKeyType="search" />
      </View>

      {people.isLoading || visits.isLoading ? (
        <LoadingState message="Loading…" />
      ) : people.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Can't reach the server" description="Check the connection and try again." actionLabel="Try again" onAction={() => people.refetch()} />
      ) : (
        <FlatList
          data={people.data ?? []}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={people.isRefetching} onRefresh={() => { void people.refetch(); void visits.refetch(); }} />}
          ListHeaderComponent={
            !search && inside.length > 0 ? (
              <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
                <Text style={styles.section}>Inside now ({inside.length})</Text>
                {inside.map((v) => (
                  <Card key={v.id} style={styles.card}>
                    <View style={styles.top}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{v.name}</Text>
                        <Text style={styles.meta}>{roleLabel(v.role)} · {v.flatCodes.join(', ')}</Text>
                      </View>
                      <StatusBadge size="sm" label="Inside" variant="success" />
                    </View>
                    <Text style={styles.time}>{visitSpan(v)}</Text>
                    <Button label="Mark as left" variant="outline" onPress={() => leave.mutate(v)} loading={busyVisit === v.id} fullWidth style={{ marginTop: spacing.sm }} />
                  </Card>
                ))}
                <Text style={styles.section}>Everyone</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const badge = helperBadge(item);
            return (
              <Card style={styles.card}>
                <View style={styles.top}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.meta}>{roleLabel(item.role)} · {item.flatCodes.join(', ')}{item.verified ? ' · Verified' : ''}</Text>
                  </View>
                  <StatusBadge size="sm" label={badge.label} variant={badge.variant} />
                </View>
                {isSuspended(item) && <Text style={styles.warn}>Suspended by the committee. Do not let them in.</Text>}
                {canLetIn(item) && <Button label="Let in" onPress={() => letIn.mutate(item)} loading={busyPerson === item.id} fullWidth style={{ marginTop: spacing.sm }} />}
              </Card>
            );
          }}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title={search ? 'No match' : 'No household help yet'} description={search ? 'Try another name or flat number.' : 'Residents add their maid, cook or driver in the app, and they appear here.'} />
          }
        />
      )}

      {/* Pass code */}
      <InlineSheet visible={codeOpen} onRequestClose={closeCode}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Pass code</Text>
          <TouchableOpacity onPress={closeCode} hitSlop={10} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {result?.kind === 'ok' ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.resultBox, { backgroundColor: colors.successLight }]}>
              <Ionicons name="checkmark-circle" size={36} color={colors.success} />
              <Text style={styles.resultTitle}>{result.already ? 'Already inside' : 'Let them in'}</Text>
              <Text style={styles.resultLine}>{result.name} · {roleLabel(result.role)}</Text>
              <Text style={styles.resultLine}>Flat {result.flats.join(', ')}</Text>
              <Text style={styles.hint}>{result.already ? 'Already inside. Use "Mark as left" when they go.' : 'Checked in. They are on the Inside now list.'}</Text>
            </View>
            <Button label="Done" onPress={closeCode} fullWidth />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.hint}>Ask for the 8-character code the resident gave them.</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => { setCode(formatCodeInput(t)); setResult(null); }}
              placeholder="XXXX-XXXX"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              autoFocus
            />
            {result?.kind === 'error' && (
              <View style={[styles.resultBox, { backgroundColor: colors.errorLight }]}>
                <Ionicons name="close-circle" size={30} color={colors.error} />
                <Text style={[styles.resultTitle, { color: colors.error }]}>Do not let them in</Text>
                <Text style={styles.resultLine}>{result.message}</Text>
              </View>
            )}
            <Button label="Check code" onPress={() => scan.mutate()} loading={scan.isPending} disabled={!isCompleteCode(code)} fullWidth />
          </View>
        )}
      </InlineSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bigButtons: { padding: spacing.base },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.base, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, paddingVertical: spacing.md },
  list: { padding: spacing.base, gap: spacing.md },
  section: { ...typography.labelLarge, color: colors.textSecondary },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  warn: { ...typography.bodySmall, color: colors.error },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  codeInput: { ...typography.headingMedium, textAlign: 'center', letterSpacing: 4 },
  resultBox: { alignItems: 'center', gap: 4, padding: spacing.lg, borderRadius: radius.lg },
  resultTitle: { ...typography.headingSmall, color: colors.success },
  resultLine: { ...typography.bodyMedium, color: colors.text, textAlign: 'center' },
});
