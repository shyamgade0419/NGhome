/**
 * Resident directory — browse who else lives in the society, by name or
 * flat. Deliberately shows only identity and flat, never contact info
 * (see UsersService.getDirectory) — tapping "Message" opens a chat
 * instead of exposing a phone number or email directly.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { directoryApi, DirectoryEntry } from '@/api/endpoints/directory.api';
import { chatApi } from '@/api/endpoints/chat.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCurrentUser } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

function EntryRow({ entry, isSelf, onMessage, messaging }: {
  entry: DirectoryEntry;
  isSelf: boolean;
  onMessage: () => void;
  messaging: boolean;
}) {
  const membership = entry.memberships[0];
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(entry.firstName, entry.lastName)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>
          {entry.firstName} {entry.lastName}{isSelf ? ' (You)' : ''}
        </Text>
        <Text style={styles.meta}>
          {membership?.flat ? `Flat ${membership.flat.flatCode}` : 'No flat assigned'}
          {membership && membership.role !== 'RESIDENT' ? ` · ${membership.role.replace(/_/g, ' ')}` : ''}
        </Text>
      </View>
      {!isSelf && (
        <TouchableOpacity style={styles.messageBtn} onPress={onMessage} disabled={messaging} hitSlop={8}>
          {messaging ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function DirectoryScreen() {
  const currentUser = useCurrentUser();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [startingChatWith, setStartingChatWith] = useState<string | null>(null);

  // Debounced — searching on every keystroke without this would fire a
  // request per character typed.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['directory', search],
    queryFn: () => directoryApi.list({ search: search || undefined, limit: 50 }),
  });

  const entries = data?.data ?? [];

  const handleMessage = async (userId: string) => {
    setStartingChatWith(userId);
    try {
      const { conversationId } = await chatApi.startConversation(userId);
      router.push(`/(app)/chat/${conversationId}` as any);
    } finally {
      setStartingChatWith(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Directory" />

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or flat…"
          placeholderTextColor={colors.textTertiary}
          value={searchInput}
          onChangeText={setSearchInput}
        />
        {isFetching && !isLoading ? <ActivityIndicator size="small" color={colors.textTertiary} /> : null}
      </View>

      {isLoading ? (
        <LoadingState message="Loading directory…" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={search ? 'No matches' : 'No residents yet'}
          description={search ? 'Try a different name or flat number.' : 'Residents will appear here once they join.'}
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              isSelf={item.id === currentUser?.id}
              messaging={startingChatWith === item.id}
              onMessage={() => handleMessage(item.id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.base, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.bodyMedium, color: colors.text, padding: 0 },

  list: { paddingHorizontal: spacing.base, paddingBottom: spacing['4xl'] },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: 52 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...typography.labelMedium, color: colors.primary },
  name: { ...typography.labelLarge, color: colors.text },
  meta: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  messageBtn: { padding: spacing.xs },
});
