import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import { membersApi, type RemovedMember } from '@/api/endpoints/members.api';
import { DeleteMemberSheet, type MemberToDelete } from '@/components/members/DeleteMemberSheet';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

const ROLES = [
  { value: 'SOCIETY_ADMIN', label: 'Admin', color: '#DC2626', bg: '#FEE2E2' },
  { value: 'SOCIETY_ACCOUNTANT', label: 'Accountant', color: '#D97706', bg: '#FEF3C7' },
  { value: 'SOCIETY_STAFF', label: 'Staff', color: '#2563EB', bg: '#DBEAFE' },
  { value: 'SECURITY_GUARD', label: 'Security guard', color: '#7C3AED', bg: '#EDE9FE' },
  { value: 'RESIDENT', label: 'Resident', color: '#059669', bg: '#D1FAE5' },
] as const;

type RoleValue = typeof ROLES[number]['value'];

function roleInfo(role: string) {
  return ROLES.find((r) => r.value === role) ?? { label: role.replace(/_/g, ' '), color: colors.textSecondary, bg: colors.surfaceSecondary };
}

function initials(name: string) {
  return name.split(' ').map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2);
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  memberships?: Array<{ role: string }>;
}

export default function RolesScreen() {
  const qc = useQueryClient();
  const [changingId, setChangingId] = useState<string | null>(null);
  // Role picker as a modal — Alert.alert only renders 3 buttons on Android,
  // which silently dropped two of the five role options.
  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const [tab, setTab] = useState<'members' | 'removed'>('members');
  const [deleteTarget, setDeleteTarget] = useState<MemberToDelete | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['society-members-mobile'],
    queryFn: () => apiClient.get<{ data: Member[] }>('/users/society', { params: { limit: 100 } }).then((r) => r.data.data ?? []),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiClient.post('/users/society/add-member', { userId, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-members-mobile'] });
      setChangingId(null);
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to update role.'),
  });

  // People whose membership ended but whose account still exists — their email and
  // phone stay taken until the account is deleted.
  const removedQ = useQuery({
    queryKey: ['removed-members-mobile'],
    queryFn: () => membersApi.removedMembers(),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/users/society/${userId}/remove`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-members-mobile'] });
      qc.invalidateQueries({ queryKey: ['removed-members-mobile'] });
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to remove member.'),
  });

  const members: Member[] = data ?? [];

  const handleChangeRole = (member: Member) => setRoleTarget(member);

  const applyRole = (role: RoleValue) => {
    if (!roleTarget) return;
    const current = roleTarget.memberships?.[0]?.role ?? 'RESIDENT';
    if (role !== current) {
      changeRoleMutation.mutate({ userId: roleTarget.id, role });
    }
    setRoleTarget(null);
  };

  // Remove ends access but keeps the account (and its email/phone) on file; Delete erases
  // the account. Three buttons is the most Android's Alert shows.
  const handleRemove = (member: Member) => {
    const name = `${member.firstName} ${member.lastName}`;
    Alert.alert(name, 'Remove ends their access but keeps the account. Delete erases the account for good, so the email and phone can be used again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove from society', onPress: () => removeMutation.mutate(member.id) },
      {
        text: 'Delete account…',
        style: 'destructive',
        onPress: () => setDeleteTarget({ userId: member.id, name, email: member.email }),
      },
    ]);
  };

  const renderItem = ({ item }: { item: Member }) => {
    const role = item.memberships?.[0]?.role ?? 'RESIDENT';
    const ri = roleInfo(role);
    const name = `${item.firstName} ${item.lastName}`;

    return (
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: ri.bg }]}>
          <Text style={[styles.avatarText, { color: ri.color }]}>{initials(name)}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
        </View>
        <TouchableOpacity
          style={[styles.roleBadge, { backgroundColor: ri.bg }]}
          onPress={() => handleChangeRole(item)}
        >
          <Text style={[styles.roleText, { color: ri.color }]}>{ri.label}</Text>
          <Ionicons name="chevron-down" size={12} color={ri.color} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleRemove(item)}
          hitSlop={8}
          style={styles.removeBtn}
        >
          <Ionicons name="trash-outline" size={16} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  const removed: RemovedMember[] = removedQ.data ?? [];

  const renderRemoved = ({ item }: { item: RemovedMember }) => (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.avatarText, { color: colors.textSecondary }]}>{initials(item.name)}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
      </View>
      <TouchableOpacity
        style={styles.deleteChip}
        onPress={() => setDeleteTarget({ userId: item.userId, name: item.name, email: item.email })}
        accessibilityLabel={`Delete account of ${item.name}`}
      >
        <Ionicons name="trash-outline" size={14} color={colors.error} />
        <Text style={styles.deleteChipText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Roles & Permissions" showBack />
      <View style={styles.tabs}>
        {([['members', 'Members'], ['removed', `Removed (${removed.length})`]] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'removed' ? (
        <FlatList
          data={removed}
          keyExtractor={(m) => m.userId}
          renderItem={renderRemoved}
          refreshControl={
            <RefreshControl refreshing={removedQ.isRefetching} onRefresh={removedQ.refetch} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.listHint}>
                These people were removed, but their account still exists, so their email and phone can&apos;t be used
                to sign up again. Delete the account to free them.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState icon="person-remove-outline" title="No removed members" description="Anyone you remove from the society appears here until their account is deleted." />
          }
          contentContainerStyle={styles.list}
        />
      ) : isLoading ? (
        <LoadingState message="Loading members…" />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderText}>{members.length} members</Text>
              <Text style={styles.listHint}>Tap a role badge to change it. Pull to refresh.</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No members found"
              description="Members appear here once they register and join the society."
            />
          }
          contentContainerStyle={styles.list}
        />
      )}

      {/* Role picker — cross-platform (Alert.alert caps at 3 buttons on Android) */}
      <Modal
        visible={!!roleTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setRoleTarget(null)}
      >
        <View style={picker.overlay}>
          <View style={picker.sheet}>
            <View style={picker.header}>
              <View style={{ flex: 1 }}>
                <Text style={picker.title}>Change Role</Text>
                {roleTarget && (
                  <Text style={picker.subtitle}>
                    {roleTarget.firstName} {roleTarget.lastName}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setRoleTarget(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {ROLES.map((r) => {
              const current = (roleTarget?.memberships?.[0]?.role ?? 'RESIDENT') === r.value;
              return (
                <TouchableOpacity
                  key={r.value}
                  style={[picker.option, current && { backgroundColor: r.bg }]}
                  onPress={() => applyRole(r.value)}
                  activeOpacity={0.7}
                >
                  <View style={[picker.dot, { backgroundColor: r.color }]} />
                  <Text style={[picker.optionText, current && { color: r.color, fontWeight: '700' }]}>
                    {r.label}
                  </Text>
                  {current && <Ionicons name="checkmark" size={18} color={r.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Last child so the in-tree sheet sits above everything. */}
      <DeleteMemberSheet member={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </SafeAreaView>
  );
}

const picker = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.headingSmall, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optionText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { paddingBottom: spacing['3xl'] },

  listHeader: {
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  listHeaderText: { ...typography.headingSmall, color: colors.text },
  listHint: { ...typography.bodySmall, color: colors.textSecondary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  divider: { height: 1, backgroundColor: colors.borderLight },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { ...typography.labelLarge, fontWeight: '700' },

  info: { flex: 1, minWidth: 0 },
  name: { ...typography.labelLarge, color: colors.text },
  email: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 1 },

  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    flexShrink: 0,
  },
  roleText: { ...typography.labelSmall, fontWeight: '600' },

  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  deleteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteChipText: { ...typography.labelSmall, color: colors.error, fontWeight: '600' },

  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
