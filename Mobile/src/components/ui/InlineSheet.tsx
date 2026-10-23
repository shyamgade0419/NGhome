import React, { useEffect } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@/theme';

/**
 * A bottom sheet drawn in the screen's own view tree rather than through
 * React Native's native <Modal>. Opening a native Modal in the same instant
 * another one closes, or an Alert shows, can leave Android's modal layer
 * unable to present anything afterwards — the expenses "Mark Paid" sheet
 * simply never opened. An in-tree overlay has no native window to get stuck.
 *
 * Render it as the LAST child of the screen's root view so it sits above
 * everything. Tapping the dimmed area or pressing the hardware back button
 * dismisses it, as a Modal's onRequestClose did.
 */
export function InlineSheet({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (!visible) return null;
  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onRequestClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView
        pointerEvents="box-none"
        style={styles.avoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  avoid: { flex: 1, justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.xl,
    paddingBottom: 40,
    gap: spacing.md,
    maxHeight: '90%',
  },
});
