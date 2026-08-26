import React from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  StyleSheet,
  ViewStyle,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

interface SafeScreenProps {
  children: React.ReactNode;
  scrollable?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  padded?: boolean;
  keyboardAware?: boolean;
}

export function SafeScreen({
  children,
  scrollable = false,
  onRefresh,
  isRefreshing = false,
  style,
  contentStyle,
  padded = false,
  keyboardAware = false,
}: SafeScreenProps) {
  const content = (
    <SafeAreaView style={[styles.safe, style]} edges={['bottom']}>
      {scrollable ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            padded && styles.padded,
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.static, padded && styles.padded, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );

  if (keyboardAware) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {content}
      </KeyboardAvoidingView>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  static: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
});
