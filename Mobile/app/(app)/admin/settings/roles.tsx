import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { societiesApi } from '@/api/endpoints/societies.api';
import apiClient from '@/api/client';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';

const ROLES = [
  { value: 'SOCIETY_ADMIN', label: 'Admin', color: '#DC2626', bg: '#FEE2E2' },
  { value: 'SOCIETY_ACCOUNTANT', label: 'Accountant', color: '#D97706', bg: '#FEF3C7' },
  { value: 'SOCIETY_STAFF', label: 'Staff', color: '#2563EB', bg: '#DBEAFE' },
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

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['society-members-mobile'],
    queryFn: () => apiClient.get<{ data: Member[] }>('/users/society', { params: { limit: 100 } }).then((r) => r.data.data ?? []),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiClient.post('/users/society/members', { userId, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['society-members-mobile'] });
      setChangingId(null);
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to update role.'),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/users/society/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['society-members-mobile'] }),
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.message ?? 'Failed to remove member.'),
  });

  const members: Member[] = data ?? [];

  const handleChangeRole = (member: Member) => {
    const current = member.memberships?.[0]?.role ?? 'RESIDENT';
    Alert.alert(
      `Change role for ${member.firstName}`,
      'Select new role:',
      [
        ...ROLES.map((r) => ({
          text: r.label + (r.value === current ? ' ✓' : ''),
          onPress: () => {
            if (r.value !== current) {
              changeRoleMutation.mutate({ userId: member.id, role: r.value });
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleRemove = (member: Member) => {
    Alert.alert(
      'Remove Member',
      `Remove ${member.firstName} ${member.lastName} from the society?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate(member.id),
        },
      ],
    );
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Roles & Permissions" showBack />
      {isLoading ? (
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
    </SafeAreaView>
  );
}

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

  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
