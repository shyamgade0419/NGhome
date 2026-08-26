import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/api/endpoints/auth.api';
import { useAuth } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography, radius } from '@/theme';

export default function ResidentProfileScreen() {
  const { user, logout } = useAuth();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  const changePasswordMutation = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      authApi.changePassword(current, next),
    onSuccess: () => {
      setShowPasswordModal(false);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      Alert.alert('Success', 'Password changed successfully.');
    },
    onError: () =>
      Alert.alert('Error', 'Failed to change password. Check your current password and try again.'),
  });

  const handleChangePassword = () => {
    if (!currentPwd || !newPwd || !confirmPwd) {
      Alert.alert('Required', 'All fields are required.');
      return;
    }
    if (newPwd.length < 8) {
      Alert.alert('Too Short', 'New password must be at least 8 characters.');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    changePasswordMutation.mutate({ current: currentPwd, next: newPwd });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My Profile" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Avatar + info */}
        <Card style={styles.profileCard} padding="lg">
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarText}>
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </Text>
          </View>
          <Text style={styles.name}>{user?.displayName}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.phone && <Text style={styles.phone}>{user.phone}</Text>}
          <View style={styles.roleChip}>
            <Text style={styles.roleText}>{user?.currentRole?.replace(/_/g, ' ')}</Text>
          </View>
        </Card>

        {/* Contact info */}
        <Card style={styles.infoCard}>
          {[
            { icon: 'mail-outline' as const, label: 'Email', value: user?.email ?? '—' },
            { icon: 'call-outline' as const, label: 'Phone', value: user?.phone ?? '—' },
          ].map((item) => (
            <View key={item.label} style={styles.infoRow}>
              <Ionicons name={item.icon} size={18} color={colors.primary} />
              <View style={styles.infoText}>
                <Text style={styles.infoLabel}>{item.label}</Text>
                <Text style={styles.infoValue}>{item.value}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Actions */}
        <Card style={styles.actionsCard} padding="none">
          {[
            {
              icon: 'key-outline' as const,
              label: 'Change Password',
              onPress: () => setShowPasswordModal(true),
            },
            {
              icon: 'notifications-outline' as const,
              label: 'Notification Preferences',
              onPress: () =>
                Alert.alert('Coming Soon', 'Notification preference settings coming soon.'),
            },
            {
              icon: 'shield-outline' as const,
              label: 'Privacy & Security',
              onPress: () =>
                Alert.alert('Coming Soon', 'Privacy settings coming soon.'),
            },
          ].map((item, i, arr) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.actionRow, i < arr.length - 1 && styles.actionRowBorder]}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <Ionicons name={item.icon} size={18} color={colors.primary} />
              <Text style={styles.actionText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </Card>

        <Button
          label="Sign Out"
          onPress={() =>
            Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: logout },
            ])
          }
          variant="outline"
          fullWidth
        />

        <Text style={styles.version}>NG Home · Powered by NovaGade</Text>
      </ScrollView>

      {/* Change Password Modal */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setShowPasswordModal(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Input
                label="Current Password"
                value={currentPwd}
                onChangeText={setCurrentPwd}
                secureTextEntry
                leftIcon="lock-closed-outline"
                required
              />
              <Input
                label="New Password"
                value={newPwd}
                onChangeText={setNewPwd}
                secureTextEntry
                leftIcon="lock-open-outline"
                hint="Min 8 characters"
                required
              />
              <Input
                label="Confirm New Password"
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                secureTextEntry
                leftIcon="lock-open-outline"
                required
              />
              <Button
                label="Update Password"
                onPress={handleChangePassword}
                loading={changePasswordMutation.isPending}
                fullWidth
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md, paddingBottom: spacing['3xl'] },

  profileCard: { alignItems: 'center', gap: spacing.sm },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: { ...typography.displaySmall, color: colors.primary, fontWeight: '700' },
  name: { ...typography.headingMedium, color: colors.text },
  email: { ...typography.bodyMedium, color: colors.textSecondary },
  phone: { ...typography.bodyMedium, color: colors.textSecondary },
  roleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.full,
    marginTop: spacing.xs,
  },
  roleText: { ...typography.labelMedium, color: colors.primary },

  infoCard: { gap: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  infoText: { flex: 1 },
  infoLabel: { ...typography.labelSmall, color: colors.textSecondary },
  infoValue: { ...typography.bodyMedium, color: colors.text, marginTop: 2 },

  actionsCard: { overflow: 'hidden' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    gap: spacing.md,
  },
  actionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  actionText: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '500' },

  version: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalBody: { padding: spacing.xl, gap: spacing.base },
});
