/**
 * Committee: the gate log. Who came, for which flat, who let them in and when.
 * A request nobody answered can be decided here, but only with a reason — the
 * reason is recorded and the flat's residents are told the committee stepped in.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VisitorEntry, VisitorEntryStatus, VisitorPolicy, visitorsApi } from '@/api/endpoints/visitors.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { ENTRY_STATUS, canOverride, timeline, visitorTypeLabel } from '@/utils/visitors';
import { colors, radius, spacing, typography } from '@/theme';

type Filter = 'ALL' | VisitorEntryStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING_APPROVAL', label: 'Waiting' },
  { key: 'CHECKED_IN', label: 'Inside' },
  { key: 'REJECTED', label: 'Declined' },
  { key: 'EXPIRED', label: 'No answer' },
];

function Stepper({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <View style={styles.stepRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.max(min, value - step))} accessibilityLabel={`Less ${label}`}>
          <Ionicons name="remove" size={18} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.stepValue}>{value}{suffix ? ` ${suffix}` : ''}</Text>
        <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(Math.min(max, value + step))} accessibilityLabel={`More ${label}`}>
          <Ionicons name="add" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function VisitorLogScreen() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [overriding, setOverriding] = useState<VisitorEntry | null>(null);
  const [reason, setReason] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [draft, setDraft] = useState<VisitorPolicy | null>(null);

  const log = useQuery({
    queryKey: ['visitor-log', filter, search.trim()],
    queryFn: () => visitorsApi.log({ status: filter === 'ALL' ? undefined : filter, search: search.trim() || undefined }),
    refetchInterval: 20_000,
  });
  const { data: policy } = useQuery({ queryKey: ['visitor-policy'], queryFn: visitorsApi.policy });

  const refresh = () => qc.invalidateQueries({ queryKey: ['visitor-log'] });

  const override = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVE' | 'REJECT' }) => visitorsApi.override(id, action, reason.trim()),
    onSuccess: () => {
      setOverriding(null);
      setReason('');
      refresh();
    },
    onError: (e) => {
      refresh();
      Alert.alert('Could not decide', apiErrorMessage(e, 'Please try again.'));
    },
  });

  const savePolicy = useMutation({
    mutationFn: (p: VisitorPolicy) => visitorsApi.updatePolicy(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visitor-policy'] });
      setPolicyOpen(false);
    },
    onError: (e) => Alert.alert('Could not save', apiErrorMessage(e, 'Please try again.')),
  });

  const openPolicy = () => {
    if (policy) setDraft({ ...policy });
    setPolicyOpen(true);
  };

  const entries = log.data?.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Gate log"
          subtitle="Visitors and who let them in"
          showBack
          rightAction={
            <TouchableOpacity onPress={openPolicy} hitSlop={8} accessibilityLabel="Visitor rules" disabled={!policy}>
              <Ionicons name="settings-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          }
        />

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Name, phone, vehicle or flat" placeholderTextColor={colors.textTertiary} autoCorrect={false} />
        </View>
        <View style={styles.filters}>
          {FILTERS.map((f) => (
            <TouchableOpacity key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {log.isLoading ? (
          <LoadingState message="Loading the gate log…" />
        ) : log.isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load the log" description="Check your connection and try again." actionLabel="Try again" onAction={() => log.refetch()} />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={log.isRefetching} onRefresh={() => log.refetch()} />}
            renderItem={({ item }) => {
              const status = ENTRY_STATUS[item.status];
              return (
                <Card style={styles.card}>
                  <View style={styles.top}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{item.visitorName}</Text>
                      <Text style={styles.meta}>
                        Flat {item.flatCode ?? '—'} · {visitorTypeLabel(item.visitorType)}
                        {item.vehicleNumber ? ` · ${item.vehicleNumber}` : ''}
                      </Text>
                    </View>
                    <StatusBadge size="sm" label={status.label} variant={status.variant} />
                  </View>
                  <Text style={styles.time}>{timeline(item)}</Text>
                  {item.registeredBy ? <Text style={styles.time}>Registered by {item.registeredBy}</Text> : null}
                  {item.decidedBy ? (
                    <Text style={styles.time}>
                      {item.decisionMethod === 'ADMIN_OVERRIDE' ? 'Committee decision by' : 'Answered by'} {item.decidedBy}
                      {item.decisionNote ? ` — ${item.decisionNote}` : ''}
                    </Text>
                  ) : null}
                  {canOverride(item) && (
                    <Button label="Decide as committee" variant="outline" size="sm" onPress={() => { setOverriding(item); setReason(''); }} style={{ marginTop: spacing.sm }} />
                  )}
                </Card>
              );
            }}
            ListEmptyComponent={<EmptyState icon="shield-checkmark-outline" title="Nothing here" description="No visitors match. Try another filter or search." />}
          />
        )}

        {/* Override */}
        <InlineSheet visible={!!overriding} onRequestClose={() => !override.isPending && setOverriding(null)}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Decide as committee</Text>
            <TouchableOpacity onPress={() => setOverriding(null)} hitSlop={10} disabled={override.isPending}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {overriding && <Text style={styles.meta}>{overriding.visitorName} · Flat {overriding.flatCode}</Text>}
          <Text style={styles.note}>The residents of that flat are told you stepped in. Your reason is kept in the audit trail.</Text>
          <TextInput style={[styles.input, { minHeight: 70 }]} value={reason} onChangeText={setReason} placeholder="Reason (required)" placeholderTextColor={colors.textTertiary} multiline maxLength={300} />
          <View style={styles.row}>
            <Button label="Approve" onPress={() => overriding && override.mutate({ id: overriding.id, action: 'APPROVE' })} loading={override.isPending && override.variables?.action === 'APPROVE'} disabled={reason.trim().length < 3 || override.isPending} style={{ flex: 1 }} />
            <Button label="Decline" variant="outline" onPress={() => overriding && override.mutate({ id: overriding.id, action: 'REJECT' })} loading={override.isPending && override.variables?.action === 'REJECT'} disabled={reason.trim().length < 3 || override.isPending} style={{ flex: 1 }} />
          </View>
        </InlineSheet>

        {/* Rules */}
        <InlineSheet visible={policyOpen} onRequestClose={() => !savePolicy.isPending && setPolicyOpen(false)}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Visitor rules</Text>
            <TouchableOpacity onPress={() => setPolicyOpen(false)} hitSlop={10} disabled={savePolicy.isPending}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {draft && (
            <View style={{ gap: spacing.md }}>
              <Text style={styles.label}>Visitors without an invitation</Text>
              <View style={styles.segment}>
                {(['REQUIRED', 'NOT_REQUIRED'] as const).map((v) => (
                  <TouchableOpacity key={v} style={[styles.segBtn, draft.walkInApproval === v && styles.segActive]} onPress={() => setDraft({ ...draft, walkInApproval: v })}>
                    <Text style={[styles.segText, draft.walkInApproval === v && styles.segTextActive]}>{v === 'REQUIRED' ? 'Resident must approve' : 'Let in without asking'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Stepper label="Longest invitation" value={draft.maxInviteDays} min={1} max={30} suffix="days" onChange={(n) => setDraft({ ...draft, maxInviteDays: n })} />
              <Stepper label="Entries per invitation" value={draft.maxUsesPerInvite} min={1} max={50} onChange={(n) => setDraft({ ...draft, maxUsesPerInvite: n })} />
              <Stepper label="Time to answer" value={draft.approvalWindowMinutes} min={5} max={240} step={5} suffix="min" onChange={(n) => setDraft({ ...draft, approvalWindowMinutes: n })} />
              <Button label="Save rules" onPress={() => savePolicy.mutate(draft)} loading={savePolicy.isPending} fullWidth />
            </View>
          )}
        </InlineSheet>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.base, marginTop: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, paddingVertical: spacing.md },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  note: { ...typography.bodySmall, color: colors.textSecondary, marginVertical: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, textAlignVertical: 'top', marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  label: { ...typography.labelMedium, color: colors.text },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { ...typography.labelMedium, color: colors.text, textAlign: 'center' },
  segTextActive: { color: colors.textInverse },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepLabel: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...typography.labelLarge, color: colors.text, minWidth: 64, textAlign: 'center' },
});
