/**
 * Resident — Financial Transparency
 *
 * Shows only what the society admin has switched on in Society Settings.
 * Corpus/other funds come from GET /funds, which residents could already
 * call (it self-filters to Fund.isVisibleToResidents — no backend change
 * needed). Account balance total and this month's expenses come from a new
 * GET /societies/my/financial-summary endpoint added alongside this screen;
 * every figure it returns is individually gated server-side by the
 * corresponding show*ToResidents flag, so this screen never has to be
 * trusted to hide something the admin didn't intend to share — a 404 here
 * just means the API hasn't been redeployed with that endpoint yet, treated
 * the same as "not enabled."
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fundsApi } from '@/api/endpoints/accounts.api';
import { societiesApi } from '@/api/endpoints/societies.api';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors, spacing, typography, radius } from '@/theme';
import { inr } from '@/utils/format';

export default function ResidentFinancesScreen() {
  const {
    data: funds,
    isLoading: fundsLoading,
    refetch: refetchFunds,
    isRefetching: fundsRefetching,
  } = useQuery({
    queryKey: ['resident-funds'],
    queryFn: fundsApi.list,
  });

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['resident-financial-summary'],
    queryFn: societiesApi.getFinancialSummary,
    // Older API deployments 404 here — treat "not available yet" the same
    // as "not enabled" rather than retrying or surfacing an error.
    retry: false,
  });

  const isLoading = fundsLoading || summaryLoading;
  const visibleFunds = funds ?? [];
  const showBalances = summary?.showBalances ?? false;
  const showExpenses = summary?.showExpenses ?? false;
  const nothingToShow = visibleFunds.length === 0 && !showBalances && !showExpenses;

  if (isLoading) return <LoadingState fullscreen message="Loading…" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Society Finances" showBack />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={fundsRefetching}
            onRefresh={() => { refetchFunds(); refetchSummary(); }}
            tintColor={colors.primary}
          />
        }
      >
        {nothingToShow ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Not shared yet"
            description="Your society admin hasn't enabled financial transparency for residents. Ask your committee if you'd like this turned on in Society Settings."
          />
        ) : (
          <>
            {showBalances && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="wallet-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardLabel}>Total Account Balance</Text>
                </View>
                <Text style={styles.cardValue}>{inr(summary?.totalBalance)}</Text>
                <Text style={styles.cardHint}>Across all active society accounts</Text>
              </View>
            )}

            {showExpenses && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="receipt-outline" size={18} color={colors.error} />
                  <Text style={styles.cardLabel}>Expenses This Month</Text>
                </View>
                <Text style={[styles.cardValue, { color: colors.error }]}>
                  {inr(summary?.monthlyExpenses)}
                </Text>
                <Text style={styles.cardHint}>Approved and paid expenses, month to date</Text>
              </View>
            )}

            {visibleFunds.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Funds</Text>
                {visibleFunds.map((f) => (
                  <View key={f.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.secondary} />
                      <Text style={styles.cardLabel}>{f.name}</Text>
                    </View>
                    <Text style={[styles.cardValue, { color: colors.secondary }]}>
                      {inr(f.currentBalance)}
                    </Text>
                    {f.description ? <Text style={styles.cardHint}>{f.description}</Text> : null}
                  </View>
                ))}
              </>
            )}
          </>
        )}
        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, gap: spacing.md },

  sectionTitle: {
    ...typography.labelSmall, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: spacing.sm, marginBottom: -spacing.xs,
  },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.xs,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardLabel: { ...typography.labelLarge, color: colors.text, fontWeight: '600' },
  cardValue: { ...typography.displaySmall, color: colors.primary, fontWeight: '700' },
  cardHint: { ...typography.bodySmall, color: colors.textTertiary },

  track: { height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.secondary },
});
