import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

export default function AdminProfileScreen() {
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
      Alert.alert('Success', 'Password changed. Please log in again.');
      logout();
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

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="Profile" />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar + name */}
        <Card style={styles.avatarCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : '?'}
            </Text>
          </View>
          <Text style={styles.name}>{user?.firstName} {user?.lastName}</Text>
          <Text style={styles.role}>Society Admin</Text>
        </Card>

        {/* Contact info */}
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Account Details</Text>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.infoText}>{user?.email}</Text>
          </View>
          {user?.phone ? (
            <View style={styles.infoRow}>
              <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.infoText}>{user.phone}</Text>
            </View>
          ) : null}
        </Card>

        {/* Actions */}
        <Card style={styles.actionsCard}>
          <Button
            label="Change Password"
            variant="outline"
            onPress={() => setShowPasswordModal(true)}
            fullWidth
          />
          <View style={styles.divider} />
          <Button
            label="Sign Out"
            variant="danger"
            onPress={handleLogout}
            fullWidth
          />
        </Card>
      </ScrollView>

      <Modal
        visible={showPasswordModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setShowPasswordModal(false);
                setCurrentPwd('');
                setNewPwd('');
                setConfirmPwd('');
              }}
            />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Input
              label="Current Password"
              value={currentPwd}
              onChangeText={setCurrentPwd}
              secureTextEntry
              leftIcon="lock-closed-outline"
            />
            <Input
              label="New Password"
              value={newPwd}
              onChangeText={setNewPwd}
              secureTextEntry
              leftIcon="lock-closed-outline"
            />
            <Input
              label="Confirm New Password"
              value={confirmPwd}
              onChangeText={setConfirmPwd}
              secureTextEntry
              leftIcon="lock-closed-outline"
            />
            <Button
              label="Update Password"
              onPress={handleChangePassword}
              loading={changePasswordMutation.isPending}
              fullWidth
              size="lg"
              style={styles.submitBtn}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.base },
  avatarCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  name: {
    ...typography.headingMedium,
    color: colors.text,
  },
  role: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  infoCard: { gap: spacing.sm },
  sectionTitle: {
    ...typography.labelMedium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoText: {
    ...typography.bodyMedium,
    color: colors.text,
    flex: 1,
  },
  actionsCard: { gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.headingSmall,
    color: colors.text,
  },
  modalContent: { padding: spacing.base, gap: spacing.base },
  submitBtn: { marginTop: spacing.sm },
});
