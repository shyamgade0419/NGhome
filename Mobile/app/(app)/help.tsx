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
    tip: 'Your bill is normally marked paid once an admin has checked the payment against the society\'s bank records. Some societies switch that check off, in which case it closes as soon as you submit.',
  },
  {
    id: 'attach-receipt',
    icon: '🧷',
    title: 'Attaching a receipt to your payment',
    summary: 'Include a screenshot or PDF as proof when submitting a payment.',
    audience: 'resident',
    steps: [
      'Go to My Bills → "I\'ve Made a Payment" (or Payments tab → the + button).',
      'Fill in the amount, date, and payment method as usual.',
      'Scroll to "Receipt / Screenshot (Optional)" and tap "Attach a photo or PDF of your receipt".',
      'Choose the screenshot or PDF from your phone.',
      'Tap "Submit Payment" — the admin can now see exactly what you attached while reviewing it.',
    ],
    tip: 'You can also open what you attached later from My Payments — look for "View receipt" under any submission.',
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
      '(Admin/Staff) Tap "+" to post one. It goes out to residents as soon as you save it.',
      '(Admin/Staff) If an announcement shows "Not visible to residents", nobody can read it yet — tap that to publish it.',
    ],
    tip: 'Admins: announcements posted before a recent update were saved but never released to residents. Any of those still show the "Not visible to residents" flag, so check your list and publish anything that should have gone out.',
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
      'If the resident attached a receipt, a "Receipt" card appears — tap it to open the actual screenshot or PDF they submitted.',
      'Verify the amount matches your bank statement, UPI history, or the receipt itself.',
      'Tap "Approve Payment" and confirm — the bill is marked paid automatically.',
      'To reject, tap "Reject Payment" and enter the reason (shown to the resident).',
    ],
    tip: 'Approving is what puts the money into an account balance — until you approve, the payment is recorded but your accounts do not reflect it. Auto-approve exists in Settings, but it closes bills on an unverified transaction ID, so most societies are better off approving manually.',
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
    id: 'pending-approvals',
    icon: '🕒',
    title: 'Approving new resident requests',
    summary: 'Review and approve someone joining a flat that already has a resident.',
    audience: 'admin',
    steps: [
      'A flat\'s first resident gets in instantly with the invite code — no approval needed.',
      'Anyone joining a flat that already has an active resident (a spouse, tenant, or co-owner) is held as "Pending" until an admin reviews it.',
      'Go to Settings → Manage Residents — a "Pending Approvals" banner appears at the top when there\'s anything to review.',
      'Check the name and which flat they\'re requesting, then tap the green ✓ to approve or the red ✕ to reject.',
      'Approving gives them immediate resident access to that flat; rejecting removes the request entirely.',
    ],
    tip: 'The person can\'t sign in at all while pending — approve or reject promptly so they\'re not stuck waiting.',
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
      'Tap "Save Payment Settings".',
      'Residents will now see a QR code and "Pay via UPI" button in their My Bills view.',
    ],
    tip: 'Do this before your first billing cycle. Until a UPI ID is saved, a resident who picks UPI sees nothing at all and has no way to pay from the app.',
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
      'Tap Submit — the expense is logged as Pending.',
      'Approve it when the committee agrees to the spend.',
      'Then tap "Mark Paid" and pick the account it came out of. This is the step that reduces your bank balance.',
    ],
    tip: 'An expense only affects your account balance once it is marked paid. Approving it records the decision, not the payment — so if your balances look high, check for approved expenses still waiting to be marked paid.',
  },
  {
    id: 'documents',
    icon: '📁',
    title: 'Documents — society files and your own',
    summary: 'View official society documents, and privately store your own.',
    audience: 'both',
    steps: [
      'Go to Documents (Profile menu, or the Docs quick link on Home).',
      'The "Society" tab lists official notices, bye-laws, and circulars posted by admin — tap one to view or download it.',
      'Switch to the "My Flat" tab to upload your own documents — tax receipts, agreements, anything you want saved against your flat.',
      'Tap the "+" button, choose a file (photo or PDF), and upload.',
    ],
    tip: 'Anything you upload under "My Flat" is private to your flat — only people who are active residents there can see it, not the admin and not other flats.',
  },
  {
    id: 'society-finances',
    icon: '🏦',
    title: 'Viewing society finances',
    summary: 'See the corpus fund and other fund balances, if your admin shares them.',
    audience: 'resident',
    steps: [
      'Go to Society Finances (Home screen → Quick Links, or Profile menu).',
      'If enabled by your society admin, you\'ll see the corpus fund and any other fund balances, plus a summary of the month\'s account balance and expenses.',
    ],
    tip: 'This screen only shows what your admin has explicitly turned on in Society Settings — if it looks empty, ask your admin to enable financial transparency.',
  },
  {
    id: 'events',
    icon: '🎉',
    title: 'Events & Activities',
    summary: 'See upcoming society events, and — for admins — plan and cost them.',
    audience: 'both',
    steps: [
      'Go to Events & Activities (Home screen Quick Links for residents; Settings → Events & Activities for admin).',
      'Each event shows its date, description, and — if entered — an estimated or actual cost.',
      '(Admin) Tap the "+" button to add an event: title, date, description, and optionally link a fund with an estimated cost.',
      '(Admin) Once you know the real cost, open the event and enter the "Actual Cost".',
    ],
    tip: 'Linking a fund while planning is just a note — it doesn\'t move any money by itself. See "Recording an event\'s real cost" for the step that actually does.',
  },
  {
    id: 'record-event-expense',
    icon: '🧮',
    title: 'Recording an event\'s real cost',
    summary: 'Turn an event\'s actual cost into a real expense that hits your accounts.',
    audience: 'admin',
    steps: [
      'Open the event and make sure both "Actual Cost" and a linked Fund are set.',
      'Tap "Record Actual Cost as Expense".',
      'Confirm — this creates a real, categorized expense (visible in your financial reports) and debits the amount from the linked fund\'s balance.',
      'Got the amount wrong? Open the event again and tap "Undo recording" — the expense is removed and the money goes back into the fund. Then record it again with the right figure.',
    ],
    tip: 'Undo stops working once the expense has been paid from a bank account, because the money has actually left by then. At that point make a correcting entry under Accounts instead.',
  },
  {
    id: 'create-account',
    icon: '🏛️',
    title: 'Setting up your society account',
    summary: 'Do this first — payments cannot be approved without one.',
    audience: 'admin',
    steps: [
      'Go to Accounts & Funds from the admin menu, on the "Accounts" tab.',
      'Tap "+" in the top-right (or "Create Account" if you have none yet).',
      'Name it so people recognise it — "HDFC Current A/c", "Petty Cash".',
      'Pick the type. Choose Cash for money collected by hand; the bank fields disappear.',
      'Add the bank name, last few digits of the account number, and IFSC if you like. These are labels for humans — nothing connects to your bank.',
      'Enter the Opening Balance: what the account holds today.',
    ],
    tip: 'Set this up before your first billing cycle. Approving a payment asks which account the money landed in, so with no account you cannot approve anything and collected money never reaches your balances. Most societies want two: the bank account their UPI ID pays into, and a Cash one.',
  },
  {
    id: 'create-fund',
    icon: '🏦',
    title: 'Setting up a corpus or sinking fund',
    summary: 'Create the pot of money a society sets aside for big future costs.',
    audience: 'admin',
    steps: [
      'Go to Accounts & Funds from the admin menu and switch to the "Funds" tab.',
      'Tap "+" in the top-right (or "Create Fund" if you have none yet).',
      'Name it — "Corpus Fund", "Sinking Fund", "Lift Replacement" — and add a short description so the committee knows what it\'s for.',
      'Enter the Opening Balance: what the fund already holds today. Leave it at 0 if you\'re starting fresh.',
      'Decide whether residents can see it. This is off by default, and it\'s the only thing controlling visibility for that fund.',
    ],
    tip: 'A fund is an earmark inside your bank account, not a separate bank account — it records how much of your money is reserved for a purpose.',
  },
  {
    id: 'fund-contribution',
    icon: '➕',
    title: 'Adding money to a fund',
    summary: 'Record corpus contributions and transfers into a fund.',
    audience: 'admin',
    steps: [
      'Go to Accounts & Funds → Funds tab and tap "Add Money" on the fund.',
      'Enter the amount and a short note, like "Corpus collection Q3".',
      'Decide the "Also add to a bank account" switch — see the tip, it matters.',
      'Tap "Add to Fund". The balance updates and the contribution is recorded in the fund\'s history.',
    ],
    tip: 'Leave "Also add to a bank account" OFF when the money already came in through the app as resident payments — it\'s in your accounts already, and turning this on would count it twice. Turn it ON only for money arriving now that was never recorded as a payment, like a cash collection.',
  },
  {
    id: 'mark-expense-paid',
    icon: '💸',
    title: 'Marking an expense as paid',
    summary: 'The step that actually takes the money out of your bank balance.',
    audience: 'admin',
    steps: [
      'Go to Expenses and find an approved expense.',
      'Tap "Mark Paid".',
      'Choose which account the money came out of — each one shows its current balance.',
      'Confirm. The account balance drops by that amount and the payment appears in that account\'s ledger.',
    ],
    tip: 'Approving an expense does not move any money — it only says the committee agreed to it. Until you mark it paid, your bank balance still counts that money as available.',
  },
  {
    id: 'create-billing-period',
    icon: '🗓️',
    title: 'Creating a billing period',
    summary: 'The first step of every billing cycle.',
    audience: 'admin',
    steps: [
      'Go to Billing & Maintenance and tap "+" in the top-right.',
      'Pick the month you\'re billing for — the period start and end dates are worked out for you and shown below.',
      'Set the payment due date. This is the date residents see on their bills.',
      'Tap "Create Period".',
      'Next: generate the bills for that period, then publish it so residents can see them.',
    ],
    tip: 'Creating a period on its own doesn\'t bill anyone. Nothing reaches residents until you generate the bills and publish the period.',
  },
  {
    id: 'notifications',
    icon: '🔔',
    title: 'Notifications',
    summary: 'See what\'s new, and — for admins — send an announcement to everyone.',
    audience: 'both',
    steps: [
      'Tap the bell icon on your Home screen — a red dot appears whenever you have something unread.',
      'Tap any notification to mark it read, or use the checkmark icon at the top to mark everything read at once.',
      '(Admin/Staff) Tap the "+" in the top-right to compose one — write a title and message, then send it to every member of the society.',
      'When your phone has notification permission granted, you\'ll also get a real alert even when the app isn\'t open.',
    ],
    tip: 'If you\'re not getting phone alerts, check that notifications are allowed for NG Home in your phone\'s Settings app.',
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
