import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { societiesApi } from '@/api/endpoints/societies.api';
import { useIsSocietyAdmin } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography, radius } from '@/theme';

interface Resident {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string | null;
  flatNumber: string;
  buildingName: string;
  role: string;
  status: string;
}

// ── Edit resident modal ──────────────────────────────────────────────────
// Mirrors the web Edit Resident modal exactly, including the "email can't
// be changed here" note — PATCH /users/:id doesn't even accept an email
// field, so this isn't a client-side restriction, it's the real contract.
function EditResidentModal({ resident, onClose }: { resident: Resident; onClose: () => void }) {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState(resident.firstName);
  const [lastName, setLastName] = useState(resident.lastName);
  const [phone, setPhone] = useState(resident.phone ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      societiesApi.updateResident(resident.userId, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-residents'] });
      Alert.alert('Saved', 'Resident info updated.');
      onClose();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to update resident.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Edit Resident</Text>
            <Text style={styles.modalSub}>{resident.flatNumber} · {resident.email}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalBody}>
            <View style={styles.nameRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Ravi"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Kumar"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>

            <Text style={[styles.label, { marginTop: spacing.base }]}>Phone (WhatsApp)</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 9876543210"
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
            />
            <Text style={styles.hint}>Used for WhatsApp billing reminders. Include country code.</Text>

            <View style={styles.emailNotice}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={styles.emailNoticeText}>
                Email address can&apos;t be changed here. Contact platform support for email changes.
              </Text>
            </View>

            <Button
              label={mutation.isPending ? 'Saving…' : 'Save Changes'}
              onPress={() => {
                if (!firstName.trim() || !lastName.trim()) {
                  Alert.alert('Required', 'First and last name are required.');
                  return;
                }
                mutation.mutate();
              }}
              loading={mutation.isPending}
              fullWidth
              style={{ marginTop: spacing.xl }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function roleLabel(role: string) {
  return role.replace('SOCIETY_', '').replace(/_/g, ' ');
}

function roleVariant(role: string): 'success' | 'warning' | 'info' | 'neutral' {
  switch (role) {
    case 'SOCIETY_ADMIN': return 'warning';
    case 'SOCIETY_ACCOUNTANT': return 'info';
    case 'SOCIETY_STAFF': return 'info';
    default: return 'neutral';
  }
}

export default function ManageResidentsScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Resident | null>(null);
  // PATCH /users/:id and DELETE .../remove are both SOCIETY_ADMIN-only —
  // this screen is reachable by Accountant/Staff too (they can view the
  // list), so gate the actions themselves rather than let them tap into
  // a guaranteed 403.
  const canManage = useIsSocietyAdmin();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['admin-residents'],
    queryFn: () => societiesApi.getResidents({ limit: 200 }),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/users/society/${userId}/remove`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-residents'] });
      Alert.alert('Removed', 'Member has been removed from the society.');
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to remove member.'),
  });

  const handleRemove = (resident: Resident) => {
    Alert.alert(
      'Remove Member',
      `Remove ${resident.displayName} (${resident.flatNumber}) from the society? They will lose access immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate(resident.userId),
        },
      ],
    );
  };

  const residents: Resident[] = data?.data ?? [];

  const filtered = search.trim()
    ? residents.filter((r) =>
        r.displayName.toLowerCase().includes(search.toLowerCase()) ||
        r.email.toLowerCase().includes(search.toLowerCase()) ||
        r.flatNumber.toLowerCase().includes(search.toLowerCase()),
      )
    : residents;

  if (isLoading) return <LoadingState fullscreen message="Loading residents…" />;
  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Residents" showBack />
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load residents"
          description="Pull down to try again."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Residents (${residents.length})`} showBack />

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, email, flat…"
          placeholderTextColor={colors.textTertiary}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item: r }) => (
          <View style={styles.row}>
            {/* Avatar */}
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {r.displayName?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>

            {/* Info */}
            <View style={styles.info}>
              <Text style={styles.name}>{r.displayName}</Text>
              <Text style={styles.sub} numberOfLines={1}>{r.email}</Text>
              <View style={styles.tagsRow}>
                <View style={styles.flatTag}>
                  <Ionicons name="home-outline" size={11} color={colors.primary} />
                  <Text style={styles.flatTagText}>{r.flatNumber}</Text>
                  {r.buildingName ? <Text style={styles.flatTagText}>· {r.buildingName}</Text> : null}
                </View>
                <StatusBadge label={roleLabel(r.role)} variant={roleVariant(r.role)} />
              </View>
              {r.phone ? (
                <Text style={styles.phone}>
                  <Ionicons name="logo-whatsapp" size={11} color="#25D366" /> {r.phone}
                </Text>
              ) : null}
            </View>

            {/* Actions */}
            {canManage && (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => setEditing(r)} hitSlop={8}>
                  <Ionicons name="create-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
                {r.role !== 'SOCIETY_ADMIN' && (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleRemove(r)} hitSlop={8}>
                    <Ionicons name="person-remove-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={search ? 'No matches' : 'No residents yet'}
            description={search ? 'Try a different search term.' : 'Residents appear here after joining via invite code.'}
          />
        }
        ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
      />

      {editing && <EditResidentModal resident={editing} onClose={() => setEditing(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  searchIcon: { flexShrink: 0 },
  searchInput: {
    flex: 1,
    ...typography.bodyMedium,
    color: colors.text,
    padding: 0,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  sep: { height: 1, backgroundColor: colors.borderLight },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { ...typography.labelLarge, color: colors.primary, fontWeight: '700' },

  info: { flex: 1, gap: 3 },
  name: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  sub: { ...typography.bodySmall, color: colors.textSecondary },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 2 },
  flatTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primaryLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  flatTagText: { ...typography.labelSmall, color: colors.primary },
  phone: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },

  actions: { flexDirection: 'row', gap: spacing.xs, alignSelf: 'center' },
  actionBtn: { padding: spacing.xs },

  emptyContainer: { flex: 1 },

  // Edit modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  modalBody: { padding: spacing.base },
  nameRow: { flexDirection: 'row', gap: spacing.md },
  label: { ...typography.labelMedium, color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    ...typography.bodyMedium, color: colors.text,
  },
  hint: { ...typography.bodySmall, color: colors.textTertiary, marginTop: 4 },
  emailNotice: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start',
    backgroundColor: colors.warningLight, borderRadius: radius.md,
    padding: spacing.sm, marginTop: spacing.base,
  },
  emailNoticeText: { ...typography.bodySmall, color: '#92400E', flex: 1, lineHeight: 16 },
});
