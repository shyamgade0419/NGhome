import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography, radius } from '@/theme';

interface SettingItem {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress: () => void;
  danger?: boolean;
}

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const items: SettingItem[] = [
    {
      icon: 'business-outline',
      label: 'Society Settings',
      sublabel: 'Name, address, contact details',
      onPress: () => router.push('/(app)/admin/settings/society' as any),
    },
    {
      icon: 'people-outline',
      label: 'Manage Residents',
      sublabel: 'View residents & their flats',
      onPress: () => router.push('/(app)/admin/settings/residents' as any),
    },
    {
      icon: 'home-outline',
      label: 'Buildings & Flats',
      sublabel: 'View society structure',
      onPress: () => router.push('/(app)/admin/settings/buildings' as any),
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Roles & Permissions',
      sublabel: 'Manage committee member access',
      onPress: () => router.push('/(app)/admin/settings/roles' as any),
    },
    {
      icon: 'grid-outline',
      label: 'Maintenance Sheet',
      sublabel: 'Monthly flat-wise collection view',
      onPress: () => router.push('/(app)/admin/maintenance-sheet/index' as any),
    },
    {
      icon: 'notifications-outline',
      label: 'Notification Settings',
      sublabel: 'Configure resident visibility',
      onPress: () => router.push('/(app)/admin/settings/notifications' as any),
    },
    {
      icon: 'construct-outline',
      label: 'Helpdesk',
      sublabel: 'Manage maintenance requests',
      onPress: () => router.push('/(app)/admin/helpdesk/index' as any),
    },
    {
      icon: 'help-circle-outline',
      label: 'Help Center',
      sublabel: 'Guides and FAQs for admins',
      onPress: () => router.push('/(app)/help' as any),
    },
    {
      icon: 'person-outline',
      label: 'My Profile',
      sublabel: 'Update personal information',
      onPress: () => router.push('/(app)/admin/profile' as any),
    },
    {
      icon: 'key-outline',
      label: 'Change Password',
      onPress: () => router.push('/(app)/admin/profile' as any),
    },
    {
      icon: 'log-out-outline',
      label: 'Sign Out',
      onPress: () =>
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Out', style: 'destructive', onPress: logout },
        ]),
      danger: true,
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </Text>
          </View>
          <View>
            <Text style={styles.profileName}>{user?.displayName}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
            <Text style={styles.profileRole}>{user?.currentRole?.replace(/_/g, ' ')}</Text>
          </View>
        </Card>

        <View style={styles.list}>
          {items.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              style={[
                styles.row,
                index === items.length - 1 && styles.rowLast,
              ]}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <View style={[styles.rowIcon, item.danger && styles.rowIconDanger]}>
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={item.danger ? colors.error : colors.primary}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, item.danger && styles.rowLabelDanger]}>
                  {item.label}
                </Text>
                {item.sublabel && <Text style={styles.rowSublabel}>{item.sublabel}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.version}>NG Home · Powered by NovaGade</Text>
        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  profileCard: {
    margin: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.headingSmall, color: colors.primary, fontWeight: '700' },
  profileName: { ...typography.headingSmall, color: colors.text },
  profileEmail: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  profileRole: { ...typography.labelSmall, color: colors.primary, marginTop: 4 },

  list: {
    marginHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.errorLight },
  rowText: { flex: 1 },
  rowLabel: { ...typography.bodyMedium, color: colors.text, fontWeight: '500' },
  rowLabelDanger: { color: colors.error },
  rowSublabel: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  version: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
