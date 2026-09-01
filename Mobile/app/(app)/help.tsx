/**
 * NG Home — In-App Help Center
 * Searchable FAQ / guide for residents and admins.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { colors, spacing, typography, radius } from '@/theme';

// ── Data ─────────────────────────────────────────────────────────────────────

type Audience = 'resident' | 'admin' | 'both';

interface Article {
  id: string;
  icon: string;
  title: string;
  summary: string;
  audience: Audience;
  steps: string[];
  tip?: string;
}

const ARTICLES: Article[] = [
  {
    id: 'pay',
    icon: '💳',
    title: 'How to pay your maintenance bill',
    summary: 'Pay via UPI, bank transfer, or cheque — and submit your payment.',
    audience: 'resident',
    steps: [
      'Open the app and go to the Home tab — your current bill is shown at the top.',
      'Tap "I\'ve Made Payment" or go to the My Bills tab.',
      'Select UPI as your payment method to get a QR code and deep link.',
      'Tap "Pay via UPI" to open PhonePe / GPay / BHIM, or scan the QR code.',
      'After paying, enter your UTR / transaction ID in the "Transaction ID" field.',
      'Tap "Submit Payment" — you\'ll get a confirmation once verified by admin.',
    ],
    tip: 'If auto-approval is enabled, your bill will be marked paid as soon as you submit with a UTR.',
  },
  {
    id: 'bill-detail',
    icon: '🧾',
    title: 'Understanding your maintenance bill',
    summary: 'What\'s included in your bill and how to view the breakdown.',
    audience: 'resident',
    steps: [
      'Go to My Bills tab to see all your bills.',
      'Tap any bill to open the detail view.',
      'You\'ll see a breakdown: Maintenance charge + Water charges + Adjustments.',
      'The Payment Summary shows how much you\'ve paid and what\'s still due.',
      'Tap the Share icon (top-right) to share your bill via WhatsApp or SMS.',
    ],
  },
  {
    id: 'helpdesk',
    icon: '🔧',
    title: 'Raising a maintenance complaint',
    summary: 'How to log plumbing, electrical, or other issues for the society.',
    audience: 'resident',
    steps: [
      'Go to the Helpdesk tab in the bottom navigation.',
      'Tap the "+" button to raise a new request.',
      'Choose a Category (Plumbing, Electrical, Civil, etc.) and Priority.',
      'Write a clear title and description of the issue.',
      'Tap Submit — the admin team will review and respond.',
      'You can check the status of your request anytime in the Helpdesk tab.',
    ],
    tip: 'Mark urgent issues as "URGENT" priority — they are highlighted for the admin team.',
  },
  {
    id: 'announcements',
    icon: '📢',
    title: 'Reading society announcements',
    summary: 'Stay updated with notices, events, and important alerts.',
    audience: 'both',
    steps: [
      'Go to the Community tab in the bottom navigation.',
      'All announcements from the society are listed here, newest first.',
      'Urgent announcements have a red indicator — check those first.',
      'Tap any announcement to read the full details.',
    ],
  },
  {
    id: 'profile',
    icon: '👤',
    title: 'Updating your profile',
    summary: 'Change your name, contact details, or password.',
    audience: 'both',
    steps: [
      'Tap the Profile tab (bottom navigation) or your avatar in the top bar.',
      'You can view your registered name, email, and flat information.',
      'Tap "Change Password" to update your password — you\'ll need your current one.',
    ],
  },
  {
    id: 'generate-bills',
    icon: '📋',
    title: 'Generating maintenance bills',
    summary: 'How to create and publish bills for a billing period.',
    audience: 'admin',
    steps: [
      'Go to the Billing tab (or Dashboard → Manage Billing).',
      'Tap the billing period you want to generate bills for.',
      'Tap "Generate Bills" — the system calculates each flat\'s maintenance amount.',
      'Review the generated bills, then tap "Publish" to make them visible to residents.',
      'Residents will see their bills in the app immediately after publishing.',
    ],
    tip: 'Make sure water charges are entered in the Water tab BEFORE generating bills — they\'re included automatically.',
  },
  {
    id: 'approve-payment',
    icon: '✅',
    title: 'Approving a resident payment',
    summary: 'Verify and approve payment submissions from residents.',
    audience: 'admin',
    steps: [
      'Go to the Payments tab — pending payments are shown first.',
      'Tap any payment to view the resident\'s details and UTR number.',
      'Verify the amount matches your bank statement or UPI history.',
      'Tap "Approve Payment" and confirm — the bill is marked paid automatically.',
      'To reject, tap "Reject Payment" and enter the reason (shown to the resident).',
    ],
    tip: 'Turn on Auto-approve in Settings → Society → UPI & Payments to skip manual verification for UPI payments with a UTR.',
  },
  {
    id: 'water',
    icon: '💧',
    title: 'Entering water meter readings',
    summary: 'Record monthly readings and allocate water costs to flats.',
    audience: 'admin',
    steps: [
      'Go to the Water tab.',
      'Select the billing period.',
      'Enter the total water bill amount and the per-unit or flat-wise breakdown.',
      'Tap "Allocate Costs" — water charges will be included in the next bill generation.',
    ],
  },
  {
    id: 'maintenance-sheet',
    icon: '📊',
    title: 'Reading the maintenance sheet',
    summary: 'View flat-wise collection status and add per-flat notes.',
    audience: 'admin',
    steps: [
      'Go to Settings → Maintenance Sheet.',
      'Select the billing period at the top.',
      'Each flat shows its total, paid, and pending amounts.',
      'Tap "Add note" on any flat to add a note visible to committee members and the resident.',
      'Use the filter buttons (All / Paid / Pending) to focus on unpaid flats.',
    ],
  },
  {
    id: 'invite',
    icon: '🔑',
    title: 'Inviting residents to join',
    summary: 'Share the society invite code so residents can register.',
    audience: 'admin',
    steps: [
      'Go to Settings → Society Settings.',
      'The Resident Invite Code is shown at the top.',
      'Tap "Copy" to copy it, or "Share via WhatsApp" to send it directly.',
      'Residents open the app → tap "Have an invite code?" on the login screen → enter the code.',
      'They select their flat and create their account.',
    ],
    tip: 'Tap "Regenerate code" if the current code is compromised — the old one stops working immediately.',
  },
  {
    id: 'upi-setup',
    icon: '⚡',
    title: 'Setting up UPI payments',
    summary: 'Configure your society\'s UPI ID for residents to pay directly.',
    audience: 'admin',
    steps: [
      'Go to Settings → Society Settings → scroll down to "UPI & Payments".',
      'Enter your society\'s UPI ID (e.g. society@upi or 9876543210@okaxis).',
      'Toggle "Auto-approve UPI payments" ON if you trust all residents — payments with a UTR are approved instantly.',
      'Tap "Save Payment Settings".',
      'Residents will now see a QR code and "Pay via UPI" button in their My Bills view.',
    ],
  },
  {
    id: 'expenses',
    icon: '💰',
    title: 'Logging society expenses',
    summary: 'Record expenditures like repairs, housekeeping, and utilities.',
    audience: 'admin',
    steps: [
      'Go to the Expenses tab.',
      'Tap the "+" button to add a new expense.',
      'Choose the category, enter the amount, description, and payment date.',
      'Tap Submit — the expense is logged and reflects in the society accounts.',
    ],
  },
];

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setOpen(!open)}
      activeOpacity={0.85}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardEmoji}>{article.icon}</Text>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{article.title}</Text>
          <Text style={styles.cardSummary} numberOfLines={open ? undefined : 1}>
            {article.summary}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textTertiary}
        />
      </View>

      {open && (
        <View style={styles.cardBody}>
          {article.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
          {article.tip && (
            <View style={styles.tipBox}>
              <Ionicons name="bulb-outline" size={14} color={colors.primary} />
              <Text style={styles.tipText}>{article.tip}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.currentRole?.includes('ADMIN') || user?.currentRole?.includes('ACCOUNTANT') || user?.currentRole?.includes('STAFF') || user?.currentRole?.includes('COMMITTEE');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'my' | 'all'>('my');

  const filtered = useMemo(() => {
    const audience = tab === 'my' ? (isAdmin ? 'admin' : 'resident') : null;
    const q = search.toLowerCase().trim();
    return ARTICLES.filter((a) => {
      const matchAudience = !audience || a.audience === audience || a.audience === 'both';
      const matchSearch = !q || a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q);
      return matchAudience && matchSearch;
    });
  }, [search, tab, isAdmin]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[0]}>
        {/* Search + tabs (sticky) */}
        <View style={styles.searchSection}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search articles…"
              placeholderTextColor={colors.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'my' && styles.tabBtnActive]}
              onPress={() => setTab('my')}
            >
              <Text style={[styles.tabText, tab === 'my' && styles.tabTextActive]}>
                {isAdmin ? '👔 Admin' : '🏠 Resident'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'all' && styles.tabBtnActive]}
              onPress={() => setTab('all')}
            >
              <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>
                📚 All Articles
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Articles */}
        <View style={styles.articles}>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyTitle}>No articles found</Text>
              <Text style={styles.emptySub}>Try a different search term.</Text>
            </View>
          ) : (
            filtered.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))
          )}
        </View>

        {/* Contact support */}
        <View style={styles.supportBox}>
          <Ionicons name="headset-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>Still need help?</Text>
            <Text style={styles.supportSub}>Contact NovaGade support</Text>
          </View>
          <TouchableOpacity
            style={styles.supportBtn}
            onPress={() => Linking.openURL('mailto:support@novagade.in')}
          >
            <Text style={styles.supportBtnText}>Email Us</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 30 },
  headerTitle: { ...typography.headingSmall, color: colors.text },

  searchSection: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyMedium,
    color: colors.text,
    padding: 0,
  },

  tabRow: { flexDirection: 'row', gap: spacing.sm },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tabText: { ...typography.labelMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary },

  articles: { padding: spacing.base, gap: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.base,
    gap: spacing.md,
  },
  cardEmoji: { fontSize: 24, lineHeight: 28 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { ...typography.labelLarge, color: colors.text, fontWeight: '700', lineHeight: 20 },
  cardSummary: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },

  cardBody: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    padding: spacing.base,
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: { ...typography.labelSmall, color: colors.primary, fontWeight: '700' },
  stepText: { ...typography.bodySmall, color: colors.text, flex: 1, lineHeight: 18 },

  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  tipText: { ...typography.bodySmall, color: colors.primary, flex: 1, lineHeight: 17 },

  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.headingSmall, color: colors.text },
  emptySub: { ...typography.bodySmall, color: colors.textSecondary },

  supportBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    margin: spacing.base,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },
  supportTitle: { ...typography.labelLarge, color: colors.text },
  supportSub: { ...typography.bodySmall, color: colors.textSecondary },
  supportBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  supportBtnText: { ...typography.labelSmall, color: '#fff', fontWeight: '600' },
});
