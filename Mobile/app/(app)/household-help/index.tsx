/**
 * Household help: the maid, cook, driver and others who work in my home. A person is added
 * once; if another flat already added them (same phone), I am simply linked to them. A new
 * person gets a pass code, shown only at that moment (and when I make a new one): the guard
 * can let them in by the code or by picking their name, and I am told when they arrive.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity, TextInput, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HelperRole, MyHelper, helpersApi } from '@/api/endpoints/helpers.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { apiErrorMessage } from '@/api/endpoints/amenities.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineSheet } from '@/components/ui/InlineSheet';
import { HELPER_ROLES, helperBadge, helperSubtitle, lastSeen, phoneForApi, phoneLooksWrong, shareMessage, visitSpan } from '@/utils/helpers';
import { colors, radius, spacing, typography } from '@/theme';

/** A code the server has just made. It is shown here and nowhere else, so sharing it is front and centre. */
function CodeBox({ name, code, societyName }: { name: string; code: string; societyName?: string | null }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.codeCard}>
        <Text style={styles.codeFor}>Entry code for {name}</Text>
        <Text selectable style={styles.code}>{code}</Text>
      </View>
      <View style={styles.onceNote}>
        <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
        <Text style={styles.onceText}>This code is shown only now and cannot be looked up later. Share it with them, or make a new one if it is lost. The guard can also let them in by name.</Text>
      </View>
      <Button label="Share the code" icon={<Ionicons name="share-social-outline" size={18} color={colors.textInverse} />} onPress={() => void Share.share({ message: shareMessage({ name, code, societyName }) })} fullWidth />
    </View>
  );
}

export default function HouseholdHelpScreen() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['my-helpers'], queryFn: helpersApi.mine, refetchInterval: 30_000 });
  const { data: society } = useQuery({ queryKey: ['society-my-mobile'], queryFn: societiesApi.getMySociety, staleTime: 5 * 60_000 });
  const societyName = society?.displayName ?? society?.name;
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-helpers'] });

  // ── add ──────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<HelperRole>('MAID');
  const [made, setMade] = useState<{ name: string; code: string } | null>(null);

  const closeAdd = () => {
    setAddOpen(false);
    setMade(null);
    setName('');
    setPhone('');
    setRole('MAID');
  };

  const add = useMutation({
    mutationFn: () => helpersApi.add({ name: name.trim(), role, phone: phoneForApi(phone) }),
    onSuccess: (res) => {
      refresh();
      if (res.code) {
        setMade({ name: res.helper.name, code: res.code });
      } else {
        closeAdd();
        Alert.alert('Added', `${res.helper.name} already works in this society, so they are now on your list too. Their existing pass code still works.`);
      }
    },
    onError: (e) => Alert.alert('Could not add', apiErrorMessage(e, 'Please try again.')),
  });
  const canAdd = name.trim().length >= 2 && !phoneLooksWrong(phone) && !add.isPending;

  // ── one person ───────────────────────────────────────────────────────────
  const [open, setOpen] = useState<MyHelper | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const visits = useQuery({ queryKey: ['my-helper-visits', open?.id], queryFn: () => helpersApi.visits(open!.id), enabled: !!open, staleTime: 0, gcTime: 0 });

  const closeOpen = () => {
    setOpen(null);
    setFresh(null);
  };

  const newCode = useMutation({
    mutationFn: () => helpersApi.newCode(open!.id),
    onSuccess: (res) => setFresh(res.code),
    onError: (e) => Alert.alert('Could not make a code', apiErrorMessage(e, 'Please try again.')),
  });
  const confirmNewCode = () =>
    Alert.alert('Make a new code?', `${open?.name}'s old code stops working straight away. Do this if they lost it or it was shared.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Make new code', onPress: () => newCode.mutate() },
    ]);

  const remove = useMutation({
    mutationFn: () => helpersApi.remove(open!.id),
    onSuccess: () => {
      refresh();
      closeOpen();
    },
    onError: (e) => {
      refresh();
      Alert.alert('Could not remove', apiErrorMessage(e, 'Please try again.'));
    },
  });
  const confirmRemove = () =>
    Alert.alert(`Remove ${open?.name}?`, 'They come off your list. If they work for another flat they stay on the society register; their past visits are kept.', [
      { text: 'Back', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate() },
    ]);

  const inside = (list.data ?? []).filter((h) => h.inside).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Household help"
          subtitle={inside > 0 ? `${inside} inside now` : 'Maid, cook, driver and others'}
          showBack
          rightAction={
            <TouchableOpacity onPress={() => setAddOpen(true)} hitSlop={8} accessibilityLabel="Add someone">
              <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
            </TouchableOpacity>
          }
        />

        {list.isLoading ? (
          <LoadingState message="Loading…" />
        ) : list.isError ? (
          <EmptyState icon="cloud-offline-outline" title="Could not load" description="Check your connection and try again." actionLabel="Try again" onAction={() => list.refetch()} />
        ) : (
          <FlatList
            data={list.data ?? []}
            keyExtractor={(h) => h.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />}
            renderItem={({ item }) => {
              const badge = helperBadge(item);
              return (
                <TouchableOpacity activeOpacity={0.8} onPress={() => setOpen(item)} accessibilityRole="button" accessibilityLabel={`Open ${item.name}`}>
                  <Card style={[styles.card, item.status === 'SUSPENDED' && styles.suspended]}>
                    <View style={styles.top}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.meta}>{helperSubtitle(item)}</Text>
                      </View>
                      <StatusBadge size="sm" label={badge.label} variant={badge.variant} />
                    </View>
                    <Text style={styles.time}>{lastSeen(item.lastVisitAt)}</Text>
                    {item.status === 'SUSPENDED' && <Text style={styles.warn}>The committee has suspended them{item.suspendedReason ? `: ${item.suspendedReason}` : ''}. The gate will not let them in.</Text>}
                  </Card>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title="No one yet"
                description="Add your maid, cook or driver. The gate knows who they are, you are told when they arrive, and you can see when they came."
                actionLabel="Add someone"
                onAction={() => setAddOpen(true)}
              />
            }
          />
        )}
      </View>

      {/* Add */}
      <InlineSheet visible={addOpen} onRequestClose={() => !add.isPending && closeAdd()}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{made ? 'Added' : 'Add someone'}</Text>
          <TouchableOpacity onPress={closeAdd} hitSlop={10} disabled={add.isPending} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {made ? (
          <View style={{ gap: spacing.md }}>
            <CodeBox name={made.name} code={made.code} societyName={societyName} />
            <Button label="Done" variant="outline" onPress={closeAdd} fullWidth />
          </View>
        ) : (
          <>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }} contentContainerStyle={{ gap: spacing.md }}>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.textTertiary} maxLength={100} />
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Mobile number" placeholderTextColor={colors.textTertiary} keyboardType="phone-pad" maxLength={20} />
              {phoneLooksWrong(phone) ? <Text style={styles.warn}>That does not look like a mobile number.</Text> : <Text style={styles.hint}>With a number, if they also work for a neighbour you are linked to the same person.</Text>}
              <Text style={styles.label}>What do they do?</Text>
              <View style={styles.chips}>
                {HELPER_ROLES.map((r) => (
                  <TouchableOpacity key={r.value} style={[styles.chip, role === r.value && styles.chipActive]} onPress={() => setRole(r.value)}>
                    <Text style={[styles.chipText, role === r.value && styles.chipTextActive]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <Button label="Add" onPress={() => add.mutate()} loading={add.isPending} disabled={!canAdd} fullWidth style={{ marginTop: spacing.md }} />
          </>
        )}
      </InlineSheet>

      {/* One person */}
      <InlineSheet visible={!!open} onRequestClose={() => !remove.isPending && closeOpen()}>
        {open && (
          <>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{open.name}</Text>
                <Text style={styles.meta}>{helperSubtitle(open)}</Text>
              </View>
              <TouchableOpacity onPress={closeOpen} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {fresh ? (
              <View style={{ gap: spacing.md }}>
                <CodeBox name={open.name} code={fresh} societyName={societyName} />
                <Button label="Done" variant="outline" onPress={() => setFresh(null)} fullWidth />
              </View>
            ) : (
              <>
                <Text style={styles.label}>Recent visits</Text>
                <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 6, paddingVertical: spacing.sm }}>
                  {visits.isLoading ? <LoadingState message="Loading visits…" /> : (visits.data ?? []).length === 0 ? (
                    <Text style={styles.hint}>No visits yet.</Text>
                  ) : (
                    (visits.data ?? []).map((v) => (
                      <Text key={v.id} style={styles.visit}>{visitSpan(v)}</Text>
                    ))
                  )}
                </ScrollView>
                <View style={styles.actions}>
                  <Button label="New code" variant="outline" onPress={confirmNewCode} loading={newCode.isPending} style={{ flex: 1 }} />
                  <Button label="Remove" variant="danger" onPress={confirmRemove} loading={remove.isPending} style={{ flex: 1 }} />
                </View>
              </>
            )}
          </>
        )}
      </InlineSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.base, gap: spacing.md },
  card: { gap: spacing.xs },
  suspended: { borderWidth: 1.5, borderColor: colors.error },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.headingSmall, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  time: { ...typography.bodySmall, color: colors.textTertiary },
  warn: { ...typography.bodySmall, color: colors.error },
  hint: { ...typography.bodySmall, color: colors.textSecondary },
  visit: { ...typography.bodySmall, color: colors.text },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { ...typography.headingSmall, color: colors.text },
  label: { ...typography.labelMedium, color: colors.textSecondary },
  input: { ...typography.bodyMedium, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMedium, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  codeCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  codeFor: { ...typography.labelMedium, color: colors.textSecondary },
  code: { ...typography.headingLarge, letterSpacing: 4, color: colors.primary, fontWeight: '800' },
  onceNote: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningLight },
  onceText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
