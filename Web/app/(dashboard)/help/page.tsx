'use client';

import { useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronUp, HelpCircle,
  LayoutDashboard, Receipt, LayoutList, FileText, CreditCard,
  Droplets, Wallet, Users, Settings, Wrench, Megaphone,
  CheckCircle2, AlertCircle, Smartphone, MessageCircle,
  Pencil, Printer, IndianRupee, TrendingUp, Building2,
  UserPlus, Shield, BarChart3, ChevronRight, FolderOpen, Bell, PiggyBank, Landmark,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';

/* ─── Types ───────────────────────────────────────────────────── */
interface Step { text: string; tip?: string; }
interface Article {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  roles: ('admin' | 'resident')[];
  steps: Step[];
  Illustration?: React.FC;
}

/* ─── Illustrations ───────────────────────────────────────────── */
function IllustrationDashboard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5">
      <div className="flex gap-1.5 flex-wrap">
        {['August 2026', 'July 2026', 'June 2026'].map((m, i) => (
          <span key={m} className={cn(
            'rounded-full px-2.5 py-1 text-[10px] font-medium',
            i === 0 ? 'bg-primary-600 text-white' : 'border border-slate-200 text-slate-500',
          )}>{m}</span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Total Billed', val: '₹2,40,000', color: 'text-blue-700' },
          { label: 'Collected', val: '₹1,80,000', color: 'text-green-700' },
          { label: 'Outstanding', val: '₹60,000', color: 'text-red-600' },
        ].map(c => (
          <div key={c.label} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
            <p className="text-[9px] text-slate-400 uppercase tracking-wide">{c.label}</p>
            <p className={cn('text-xs font-bold tabular-nums', c.color)}>{c.val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IllustrationBilling() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-700">August 2026</span>
        <span className="rounded-full bg-amber-100 text-amber-700 text-[9px] font-medium px-2 py-0.5">DRAFT</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex gap-1.5">
          <span className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[9px] font-medium px-2 py-1">1. Create Period</span>
          <ChevronRight size={12} className="text-slate-300 self-center" />
          <span className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[9px] font-medium px-2 py-1">2. Generate Bills</span>
          <ChevronRight size={12} className="text-slate-300 self-center" />
          <span className="rounded-md bg-primary-600 text-white text-[9px] font-medium px-2 py-1">3. Publish</span>
        </div>
        <p className="text-[9px] text-slate-400">Bills are sent to residents only after publishing.</p>
      </div>
    </div>
  );
}

function IllustrationStatement() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[9px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-2 py-1.5 text-left font-semibold text-slate-500">Flat</th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-500">Resident</th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-500">Total</th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-500">Status</th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-500">Note</th>
              <th className="px-2 py-1.5 text-center font-semibold text-slate-500">WhatsApp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {[
              { flat: 'A-101', name: 'Ramesh K.', amt: '₹2,500', paid: true, note: 'Paid on 3rd' },
              { flat: 'A-102', name: 'Priya S.', amt: '₹2,800', paid: false, note: '' },
            ].map(r => (
              <tr key={r.flat}>
                <td className="px-2 py-1.5 font-bold text-slate-800">{r.flat}</td>
                <td className="px-2 py-1.5 text-slate-500">{r.name}</td>
                <td className="px-2 py-1.5 text-right font-medium text-slate-800">{r.amt}</td>
                <td className="px-2 py-1.5">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[8px] font-medium',
                    r.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                  )}>{r.paid ? '✓ Paid' : 'Unpaid'}</span>
                </td>
                <td className="px-2 py-1.5 text-slate-400 italic">{r.note || '—'}</td>
                <td className="px-2 py-1.5 text-center">
                  {!r.paid && (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700">
                      <MessageCircle size={10} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IllustrationMyBills() {
  return (
    <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle size={14} className="text-amber-600" />
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-800">August 2026</p>
            <p className="text-[10px] text-slate-400">Due 10 Aug · ₹2,500 pending</p>
          </div>
        </div>
        <ChevronDown size={14} className="text-slate-400" />
      </div>
      <div className="border-t border-slate-100 px-4 py-3 space-y-2 bg-slate-50">
        <button className="w-full rounded-lg border-2 border-primary-300 bg-primary-50 text-primary-700 py-2 text-[10px] font-semibold flex items-center justify-center gap-1.5">
          <Smartphone size={12} /> Pay ₹2,500 via UPI
        </button>
        <p className="text-[9px] text-center text-slate-400">Open GPay → pay → enter UTR → Confirm</p>
      </div>
    </div>
  );
}

function IllustrationPayments() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-700">Pending Verifications</span>
        <span className="rounded-full bg-amber-100 text-amber-700 text-[9px] font-medium px-2 py-0.5">3 pending</span>
      </div>
      <div className="divide-y divide-slate-50">
        {[
          { flat: 'A-102', name: 'Priya S.', amt: '₹2,800', method: 'UPI', utr: '4261...7890' },
        ].map(p => (
          <div key={p.flat} className="px-3 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-slate-800">Flat {p.flat} · {p.name}</p>
              <p className="text-[9px] text-slate-400">{p.method} · UTR {p.utr}</p>
            </div>
            <div className="flex gap-1.5 items-center">
              <span className="text-[11px] font-bold text-slate-800">{p.amt}</span>
              <button className="rounded-md bg-green-600 text-white text-[9px] px-2 py-1 font-medium">Approve</button>
              <button className="rounded-md border border-slate-200 text-slate-500 text-[9px] px-2 py-1">Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IllustrationWater() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100">
        <span className="text-[11px] font-semibold text-slate-700">Water Readings — August 2026</span>
      </div>
      <div className="divide-y divide-slate-50">
        {[
          { flat: 'A-101', prev: '1250.00', curr: '1310.50', units: '60.5' },
          { flat: 'A-102', prev: '980.00', curr: '', units: '—' },
        ].map(r => (
          <div key={r.flat} className="px-3 py-2 flex items-center gap-3">
            <span className="text-[10px] font-bold text-slate-800 w-10">{r.flat}</span>
            <div className="flex gap-2 flex-1 items-center">
              <div className="flex-1">
                <p className="text-[8px] text-slate-400">Prev (KL)</p>
                <p className="text-[10px] text-slate-600">{r.prev}</p>
              </div>
              <div className="flex-1">
                <p className="text-[8px] text-slate-400">Current (KL)</p>
                <input readOnly value={r.curr} placeholder="Enter reading"
                  className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] bg-white" />
              </div>
              <div className="flex-1">
                <p className="text-[8px] text-slate-400">Units</p>
                <p className="text-[10px] font-medium text-blue-700">{r.units}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IllustrationSettings() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100">
        <span className="text-[11px] font-semibold text-slate-700">Payment Settings</span>
      </div>
      <div className="px-3 py-3 space-y-2.5">
        <div>
          <p className="text-[9px] font-medium text-slate-500 mb-1">Society UPI ID</p>
          <div className="flex gap-1.5">
            <input readOnly value="society@ybl" className="flex-1 rounded border border-slate-200 px-2 py-1 text-[10px] bg-slate-50" />
            <button className="rounded bg-primary-600 text-white text-[9px] px-2 py-1 font-medium">Save</button>
          </div>
          <p className="text-[8px] text-slate-400 mt-1">Residents will use this UPI ID to pay maintenance.</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-medium text-slate-700">Auto-confirm UPI payments</p>
            <p className="text-[8px] text-slate-400">Bills marked paid instantly when UTR is submitted</p>
          </div>
          <div className="h-4 w-7 rounded-full bg-primary-600 relative">
            <div className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow" />
          </div>
        </div>
      </div>
    </div>
  );
}

function IllustrationHelpdesk() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100">
        <span className="text-[11px] font-semibold text-slate-700">Submit a Request</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Category</p>
          <div className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 bg-slate-50">Plumbing</div>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Title</p>
          <div className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600 bg-slate-50">Water leakage in bathroom</div>
        </div>
        <button className="w-full rounded-lg bg-primary-600 text-white text-[10px] font-semibold py-1.5">Submit Request</button>
      </div>
    </div>
  );
}

/* ─── Articles ───────────────────────────────────────────────── */
const ARTICLES: Article[] = [
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    subtitle: 'View financial summaries by month and track collection status',
    icon: LayoutDashboard,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    roles: ['admin'],
    Illustration: IllustrationDashboard,
    steps: [
      { text: 'Open the Dashboard from the left sidebar.' },
      { text: 'Use the month pills at the top to select a billing period (e.g. "August 2026"). The dashboard defaults to the latest published period.' },
      { text: 'The Financials section shows Total Billed, Collected, Outstanding, and Expenses for that month.' },
      { text: 'Use the left/right arrows to navigate between published periods.', tip: 'Only months with published billing periods appear as selectable pills.' },
      { text: 'Bank Balance and Corpus Fund shown at the bottom are always current — not month-specific.' },
      { text: 'A yellow alert appears if there are pending payment verifications. Click "review now" to go directly to the payments queue.' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing — Create & Publish',
    subtitle: 'Generate monthly maintenance bills and publish them to residents',
    icon: Receipt,
    color: 'text-indigo-700',
    bg: 'bg-indigo-50',
    roles: ['admin'],
    Illustration: IllustrationBilling,
    steps: [
      { text: 'Go to Billing → click "New Period" and enter the month and due date.' },
      { text: 'Click "Generate Bills" to create bills for all active flats based on billing rules.' },
      { text: 'Review each flat\'s bill. You can adjust amounts individually if needed.' },
      { text: 'Enter water meter readings for the period under Water Billing before publishing if applicable.', tip: 'Water charges are auto-calculated from readings × rate per KL.' },
      { text: 'Click "Publish" to make bills visible to residents. Published bills cannot be edited — close the period first if corrections are needed.' },
      { text: 'Residents will see their bill immediately in My Bills after publishing.' },
    ],
  },
  {
    id: 'statement',
    title: 'Maintenance Sheet',
    subtitle: 'Society-wide view of all bills — add notes, send reminders, print',
    icon: LayoutList,
    color: 'text-teal-700',
    bg: 'bg-teal-50',
    roles: ['admin', 'resident'],
    Illustration: IllustrationStatement,
    steps: [
      { text: 'Go to Maintenance Sheet and select a published period from the pills at the top.' },
      { text: 'The table shows every flat: maintenance amount, water charges, arrears, late fees, and total payable.' },
      { text: '(Admin) Click any cell in the Note column to add a private note for that flat — e.g. "Cheque received", "On vacation". Residents see these notes read-only.', tip: 'Notes are saved per billing period per flat.' },
      { text: '(Admin) Click the green WhatsApp icon 💬 on any unpaid row to open a pre-filled reminder message in WhatsApp. Works on desktop (WhatsApp Web) and mobile.', tip: 'Only rows with a registered phone number and unpaid status show the WhatsApp button.' },
      { text: 'Your flat row is highlighted in blue so you can quickly find it.' },
      { text: 'Click "Print / PDF" for A4 landscape output — navigation and summary cards are hidden automatically.' },
    ],
  },
  {
    id: 'my-bills',
    title: 'My Bills & UPI Payment',
    subtitle: 'View your maintenance bills and pay directly via UPI apps',
    icon: FileText,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    roles: ['admin', 'resident'],
    Illustration: IllustrationMyBills,
    steps: [
      { text: 'Go to My Bills. Summary cards at the top show your total pending and total paid across all periods.' },
      { text: 'Click any bill card to expand it and see the full breakdown: maintenance, water, late fees, and arrears.' },
      { text: 'For unpaid bills, tap "Pay ₹X via UPI" to open the payment panel.' },
      { text: 'Copy the UPI ID or click "Open UPI App" to launch GPay / PhonePe / Paytm / BHIM directly with the amount pre-filled.', tip: 'The UPI deep link works on Android phones. On desktop, copy the UPI ID and pay manually in your banking app.' },
      { text: 'After paying, enter your UTR / Transaction ID from the UPI app (12-digit number shown after payment).' },
      { text: 'Click "Confirm Payment". If the society has auto-confirm enabled, your bill is marked paid instantly. Otherwise, admin will verify within 24 hours.' },
    ],
  },
  {
    id: 'payments',
    title: 'Payment Verification',
    subtitle: 'Review, approve, or reject resident payment submissions',
    icon: CreditCard,
    color: 'text-green-700',
    bg: 'bg-green-50',
    roles: ['admin'],
    Illustration: IllustrationPayments,
    steps: [
      { text: 'Go to Payments. Use the status filter to see "Pending" submissions.' },
      { text: 'Click a payment to open details — you\'ll see the UTR, amount, method, and linked bill.' },
      { text: 'If the resident attached a receipt from the mobile app, a "Receipt" link appears — click it to open the actual screenshot or PDF they submitted.', tip: 'Attaching a receipt is currently a mobile-only feature — residents submitting from the web app can\'t attach one yet.' },
      { text: 'To approve: select the bank account to credit, then click "Approve". The bill\'s paid/pending amounts update automatically.', tip: 'If auto-confirm is enabled in Settings, UPI payments with UTR are approved instantly without this step.' },
      { text: 'To reject: click "Reject" and enter a reason. The resident can resubmit with a corrected UTR.' },
      { text: 'Approved payments create a Credit transaction in the linked bank account — visible in Accounts.' },
    ],
  },
  {
    id: 'water',
    title: 'Water Billing',
    subtitle: 'Enter meter readings and auto-calculate water charges per flat',
    icon: Droplets,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    roles: ['admin'],
    Illustration: IllustrationWater,
    steps: [
      { text: 'Go to Water Billing and select the billing period.' },
      { text: 'Previous readings are auto-filled from the last period\'s closing readings.' },
      { text: 'Enter the current meter reading for each flat in the "Current (KL)" column.' },
      { text: 'Units consumed (difference) are calculated automatically.' },
      { text: 'Water charges = Units × Rate per KL (configured in Settings → Billing Rules).', tip: 'Set the water rate under Billing Rules → Water Charge component.' },
      { text: 'Save readings before publishing the billing period — they\'re included in each flat\'s bill.' },
    ],
  },
  {
    id: 'residents',
    title: 'Managing Residents',
    subtitle: 'Invite new residents, manage memberships, and edit details',
    icon: Users,
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    roles: ['admin'],
    steps: [
      { text: 'Go to Residents to see all active society members.' },
      { text: 'To invite a new resident: go to their flat, click "Assign Resident", and share the invite code. The resident uses this code on the Register page.' },
      { text: 'A flat\'s first resident joins instantly. Anyone joining a flat that already has an active resident (a spouse, tenant, or co-owner) shows up in a "Pending Approvals" panel at the top of this page instead — click ✓ to approve or ✕ to reject.', tip: 'They can\'t sign in at all while pending, so review these promptly.' },
      { text: 'Click a resident\'s name to view and edit their details — phone number, email, and flat assignment.' },
      { text: 'To remove a resident: click the three-dot menu → Remove from Society. Their billing history is preserved.', tip: 'A flat must have at most one active resident for billing to work correctly.' },
      { text: 'The phone number stored here is used for the WhatsApp reminder button on the Maintenance Sheet.' },
    ],
  },
  {
    id: 'expenses',
    title: 'Recording Expenses',
    subtitle: 'Track society expenses and approve them into the accounts',
    icon: Wallet,
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    roles: ['admin'],
    steps: [
      { text: 'Go to Expenses → "New Expense". Enter the vendor, amount, category, and date.' },
      { text: 'Upload a receipt or invoice as proof (optional but recommended).' },
      { text: 'Submitted expenses start as "Pending". An admin or accountant must approve them.' },
      { text: 'To approve: find the expense and click "Approve". This records that the committee agreed to the spend — it does not move any money yet.' },
      { text: 'Then click "Mark Paid" and choose which account the money came out of. This is the step that reduces your bank balance and writes the payment into that account\'s ledger.', tip: 'If your balances look higher than the bank says, check for approved expenses still waiting to be marked paid.' },
      { text: 'Expenses appear in the Dashboard\'s Total Expenses widget for the relevant month.' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings & UPI Setup',
    subtitle: 'Configure UPI ID, billing rules, late fees, and payment options',
    icon: Settings,
    color: 'text-slate-700',
    bg: 'bg-slate-100',
    roles: ['admin'],
    Illustration: IllustrationSettings,
    steps: [
      { text: 'Go to Settings → Payment Settings.' },
      { text: 'Enter your Society UPI ID (e.g. "societyname@ybl"). This is displayed to residents when they pay.', tip: 'Get this from your bank or the UPI app linked to the society account.' },
      { text: 'Leave "Require payment verification" ON. With it on, you approve each payment and choose which account it lands in, which is what puts the money into your balances.', tip: 'Switching it off marks bills paid automatically, but the money is not added to any account and no ledger entry is written — your balances will drift from the bank.' },
      { text: 'Go to Settings → Billing Rules to set maintenance amounts per flat category, water rates, and late fee structure.' },
      { text: 'Go to Settings → Society Info to update the society\'s display name, address, and contact email — shown on bills and statements.' },
    ],
  },
  {
    id: 'helpdesk',
    title: 'Helpdesk Requests',
    subtitle: 'Submit maintenance complaints and track their resolution',
    icon: Wrench,
    color: 'text-red-700',
    bg: 'bg-red-50',
    roles: ['resident', 'admin'],
    Illustration: IllustrationHelpdesk,
    steps: [
      { text: 'Go to Helpdesk → "New Request".' },
      { text: 'Choose a category (Plumbing, Electrical, Cleaning, Security, etc.) and priority.' },
      { text: 'Write a clear title and description of the issue. The more detail you provide, the faster it gets resolved.' },
      { text: 'Submit the request. You\'ll see it listed with an OPEN status.' },
      { text: 'Click the conversation icon on any request to open its thread. Both the resident and the society can reply there, and each side is notified when the other does.', tip: 'Only the resident who raised a request and the society\'s staff can see it — not other residents.' },
      { text: '(Admin) Replying and changing the status are separate on purpose: answering a question never moves a request to Resolved by accident. Use "Update" when the work itself moves on.' },
      { text: '(Admin) When a resident replies, whoever the request is assigned to is notified; if nobody is, the society admins are. Assign requests so replies reach the right person.' },
    ],
  },
  {
    id: 'community',
    title: 'Community & Announcements',
    subtitle: 'Read society notices and stay updated on events',
    icon: Megaphone,
    color: 'text-pink-700',
    bg: 'bg-pink-50',
    roles: ['resident', 'admin'],
    steps: [
      { text: 'Go to Community to see all society announcements.' },
      { text: 'Announcements are listed newest first. Click one to read the full message.' },
      { text: '(Admin) Click "New Announcement" to post a notice to all residents — maintenance shutdowns, events, AGM dates, etc. It reaches residents as soon as you save it.' },
      { text: '(Admin) If an announcement shows "Not visible to residents", nobody can read it yet — click that to publish it.', tip: 'Announcements posted before a recent update were saved but never released to residents. Any of those still carry that flag, so check your list and publish anything that should have gone out.' },
      { text: 'Important announcements are pinned at the top by admin.' },
    ],
  },
  {
    id: 'accounts',
    title: 'Society Accounts',
    subtitle: 'Set up where your money is tracked — do this before your first bill',
    icon: Landmark,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    roles: ['admin'],
    steps: [
      { text: 'Go to Accounts & Funds → "New Account".' },
      { text: 'Name it so people recognise it ("HDFC Current A/c", "Petty Cash") and pick the type. Choose Cash for money collected by hand.' },
      { text: 'Bank name, account number and IFSC are optional labels for humans — nothing here connects to your bank.', tip: 'An account is a record for tracking money. Its balance moves only as you approve payments and mark expenses paid, so if it drifts from your real bank statement, something has not been recorded.' },
      { text: 'Enter the Opening Balance: what the account holds today.' },
      { text: 'Most societies want two — the bank account their UPI ID pays into, and a Cash one for anything collected by hand.' },
      { text: 'Do this before your first billing cycle.', tip: 'Approving a payment asks which account the money landed in. With no account you cannot approve anything, so residents can pay and none of it reaches your balances.' },
    ],
  },
  {
    id: 'funds',
    title: 'Corpus & Reserve Funds',
    subtitle: 'Set aside money for big future costs, and record contributions',
    icon: PiggyBank,
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    roles: ['admin'],
    steps: [
      { text: 'Go to Accounts & Funds → "New Fund". Name it (Corpus Fund, Sinking Fund, Lift Replacement), and set the Opening Balance to whatever it already holds today.' },
      { text: 'Decide whether residents can see it. This is off by default and it is the only thing that controls visibility for that fund.', tip: 'The "Show total bank balance to residents" switch in Settings covers the combined bank balance only — it does not hide or reveal funds.' },
      { text: 'To add money later, click "Add Money" on the fund, enter the amount and a note like "Corpus collection Q3".' },
      { text: 'Leave "Also credit a bank account" set to "No" when the money already came in as resident payments — it is in your accounts already.', tip: 'Choosing an account there adds the money to that balance too. Correct for a cash collection that was never recorded as a payment; double-counting for anything that came through the app.' },
      { text: 'A fund is an earmark inside your bank accounts, not a separate bank account. That is why the Accounts page shows Total Bank Balance and Total Fund Balance as two separate figures rather than adding them together.' },
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    subtitle: 'View official society notices, bye-laws, and circulars',
    icon: FolderOpen,
    color: 'text-cyan-700',
    bg: 'bg-cyan-50',
    roles: ['resident', 'admin'],
    steps: [
      { text: 'Go to Documents to see files posted by the society admin.' },
      { text: 'Click "View / Download" on any document to open it.' },
      { text: '(Admin) Click "Add Document" to register a new one — give it a title, an access level (Public, Residents Only, or Admin Only), and a link to where the file is hosted.' },
      { text: 'Residents can also privately upload their own flat documents (tax receipts, agreements) from the mobile app — those never appear here, only to that flat.', tip: 'Uploading a real file (not just a link) and viewing a flat\'s private documents are currently mobile-only.' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    subtitle: 'Send an announcement to everyone, or catch up on what you\'ve missed',
    icon: Bell,
    color: 'text-yellow-700',
    bg: 'bg-yellow-50',
    roles: ['resident', 'admin'],
    steps: [
      { text: 'Go to Notifications to see everything sent to you, newest first.' },
      { text: 'Click the checkmark on any unread item to mark it read.' },
      { text: '(Admin/Staff) Click "Compose" in the top-right, write a title and message, and send it to every member of the society at once.' },
      { text: 'On the mobile app, this also sends a real phone notification — not just something waiting in this list.', tip: 'Push notifications are mobile-only; the web app doesn\'t show a phone-style alert.' },
    ],
  },
];

/* ─── Article Card ─────────────────────────────────────────── */
function ArticleCard({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  const Icon = article.icon;
  const Illustration = article.Illustration;

  return (
    <div className={cn(
      'rounded-xl border bg-white shadow-sm overflow-hidden transition-shadow',
      open ? 'border-primary-200 shadow-md' : 'border-slate-200',
    )}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', article.bg)}>
          <Icon size={18} className={article.color} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm">{article.title}</p>
          <p className="text-xs text-slate-500 truncate">{article.subtitle}</p>
        </div>
        <div className="flex-shrink-0 text-slate-400">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 py-5">
          <div className={cn('gap-6', Illustration ? 'grid grid-cols-1 lg:grid-cols-2' : '')}>
            {/* Steps */}
            <div className="space-y-3">
              {article.steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 leading-relaxed">{step.text}</p>
                    {step.tip && (
                      <p className="mt-1 text-xs text-primary-600 bg-primary-50 rounded-lg px-3 py-1.5 border border-primary-100">
                        💡 {step.tip}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Illustration */}
            {Illustration && (
              <div className="flex flex-col justify-start">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Preview</p>
                <Illustration />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────── */
export default function HelpPage() {
  const { activeMembership, user } = useAuth();
  const role = activeMembership?.role ?? user?.currentRole ?? '';
  const isAdmin =
    ['SOCIETY_ADMIN', 'SOCIETY_ACCOUNTANT', 'SOCIETY_STAFF', 'PLATFORM_ADMIN'].includes(role) ||
    !!user?.isPlatformAdmin;

  const [activeTab, setActiveTab] = useState<'admin' | 'resident'>(isAdmin ? 'admin' : 'resident');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return ARTICLES.filter(a => {
      if (!a.roles.includes(activeTab)) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q) ||
        a.steps.some(s => s.text.toLowerCase().includes(q))
      );
    });
  }, [activeTab, query]);

  return (
    <>
      <Header title="Help Center" subtitle="Step-by-step guides for NG Home" />
      <PageContainer className="space-y-6 max-w-4xl">

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search articles…"
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-400 placeholder:text-slate-400"
          />
        </div>

        {/* Role tabs (only show both if admin) */}
        {isAdmin && (
          <div className="flex gap-2 border-b border-slate-200 pb-0">
            {(['admin', 'resident'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === tab
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700',
                )}
              >
                {tab === 'admin' ? '🛡️ Admin & Staff' : '🏠 Residents'}
              </button>
            ))}
          </div>
        )}

        {/* Articles */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
            <HelpCircle size={36} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No articles match &ldquo;{query}&rdquo;</p>
            <button onClick={() => setQuery('')} className="mt-2 text-xs text-primary-600 hover:underline">
              Clear search
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(article => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 flex items-start gap-3">
          <Shield size={18} className="text-slate-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-700">Need more help?</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Contact your society admin or reach NovaGade support at{' '}
              <a href="mailto:support@novagade.in" className="text-primary-600 hover:underline">
                support@novagade.in
              </a>
            </p>
          </div>
        </div>

      </PageContainer>
    </>
  );
}
