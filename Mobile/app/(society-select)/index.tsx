import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius, shadow } from '@/theme';
import { SocietyMembership } from '@/types/auth.types';

const ROLE_LABELS: Record<string, string> = {
  SOCIETY_ADMIN: 'Admin',
  SOCIETY_ACCOUNTANT: 'Accountant',
  SOCIETY_STAFF: 'Staff',
  COMMITTEE_MEMBER: 'Committee',
  RESIDENT: 'Resident',
  PLATFORM_ADMIN: 'Platform Admin',
};

export default function SocietySelectScreen() {
  const router = useRouter();
  const { pendingMemberships, selectSociety, logout } = useAuthContext();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSelect = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await selectSociety(selected);
      router.replace('/(app)');
    } catch {
      Alert.alert('Error', 'Failed to switch society. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: SocietyMembership }) => {
    // Keyed by membership id, not societyId — two cards can share the same
    // society (an admin membership and a resident membership on one flat,
    // both in the same society), and societyId alone can't tell them apart.
    const isSelected = selected === item.id;
    return (
      <TouchableOpacity
        style={[styles.card, isSelected && styles.cardSelected]}
        onPress={() => setSelected(item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.cardLeft}>
          {item.societyLogo ? (
            <Image source={{ uri: item.societyLogo }} style={styles.logo} />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Ionicons name="business" size={22} color={colors.primary} />
            </View>
          )}
        </View>

        <View style={styles.cardCenter}>
          <Text style={styles.societyName}>{item.societyName}</Text>
          {item.flatNumber && (
            <Text style={styles.flatInfo}>
              {item.buildingName ? `${item.buildingName} · ` : ''}
              {item.flatNumber}
            </Text>
          )}
          <StatusBadge
            label={ROLE_LABELS[item.role] ?? item.role}
            variant={item.role === 'RESIDENT' ? 'info' : 'primary'}
            size="sm"
          />
        </View>

        <View style={styles.cardRight}>
          <View style={[styles.radio, isSelected && styles.radioSelected]}>
            {isSelected && <View style={styles.radioDot} />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.logoMark}>
          <Ionicons name="home" size={20} color={colors.textInverse} />
        </View>
        <View>
          <Text style={styles.headerTitle}>Select Society</Text>
          <Text style={styles.headerSubtitle}>You belong to multiple societies</Text>
        </View>
      </View>

      <FlatList
        data={pendingMemberships}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <View style={styles.footer}>
        <Button
          label={loading ? 'Entering Society...' : 'Continue'}
          onPress={handleSelect}
          disabled={!selected || loading}
          loading={loading}
          fullWidth
          size="lg"
        />
        <Button
          label="Sign Out"
          onPress={logout}
          variant="ghost"
          fullWidth
          style={styles.signOutBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...typography.headingSmall, color: colors.text },
  headerSubtitle: { ...typography.bodySmall, color: colors.textSecondary },

  list: { padding: spacing.base, gap: 0 },
  separator: { height: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadow.sm,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  cardLeft: {},
  logo: { width: 48, height: 48, borderRadius: 12 },
  logoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCenter: { flex: 1, gap: 4 },
  societyName: { ...typography.headingSmall, color: colors.text },
  flatInfo: { ...typography.bodySmall, color: colors.textSecondary },
  cardRight: {},
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },

  footer: {
    padding: spacing.base,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  signOutBtn: { marginTop: -spacing.xs },
});
