/**
 * Maintenance Sheet — shared by admins and residents.
 *
 * The underlying endpoint (GET /billing/periods/:id/statement) is readable by
 * every society member: residents see all flats for transparency, matching the
 * web sidebar which lists this for both roles. Note editing is admin-only,
 * because PATCH /billing/bills/:billId/notes is gated to ADMIN/ACCOUNTANT.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import apiClient from '@/api/client';
import { billingApi } from '@/api/endpoints/billing.api';
import { useAuth } from '@/hooks/useAuth';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors, spacing, typography, radius } from '@/theme';
import { toNum, inr, inrCompact } from '@/utils/format';
import { BillingPeriod, billingPeriodName } from '@/types/billing.types';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Mirrors one row of GET /billing/periods/:periodId/statement.
 * All monetary fields arrive as numbers (the service calls .toNumber()),
 * not decimal strings — do not parseFloat them.
 */
interface FlatRow {
  flatId: string;
  flatCode: string;
  billId: string;
  invoiceNumber?: string;
  isPaid: boolean;
  isPublished: boolean;
  notes: string | null;
  residentName: string;
  residentPhone: string | null;
  generalMaintenance: number;
  waterCharges: number;
  adjustments: number;
  lateFee: number;
  otherCharges: number;
  arrears: number;
  totalPayable: number;
}

// ── Period selector ───────────────────────────────────────────────────────────

function PeriodPicker({
  periods,
  selected,
  onSelect,
}: {
  periods: BillingPeriod[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.periodRow}
    >
      {periods.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={[styles.periodChip, selected === p.id && styles.periodChipActive]}
          onPress={() => onSelect(p.id)}
        >
          <Text style={[styles.periodChipText, selected === p.id && styles.periodChipTextActive]}>
            {MONTHS[(p.periodMonth ?? 1)]} {p.periodYear}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Notes modal ───────────────────────────────────────────────────────────────

function NotesModal({
  flat,
  onClose,
}: {
  flat: FlatRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(flat.notes ?? '');

  const mutation = useMutation({
    // Notes are keyed by bill, not by flat — there is no /maintenance-sheet controller.
    mutationFn: () =>
      apiClient.patch(`/billing/bills/${flat.billId}/notes`, {
        notes: note.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-sheet'] });
      Alert.alert('Saved', 'Note updated for this flat.');
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to save note.'),
  });

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalTitle}>Notes — Flat {flat.flatCode}</Text>
            {flat.residentName && (
              <Text style={styles.modalSub}>{flat.residentName}</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.noteHint}>
              Add notes for this flat — visible to all committee members and the resident.
            </Text>
            <TextInput
              style={styles.noteInput}
              placeholder="e.g. Partial payment agreed, Leakage reported, pending repair…"
              placeholderTextColor={colors.textTertiary}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.saveBtn, mutation.isPending && styles.saveBtnDisabled]}
              onPress={() => mutation.mutate()}
              disabled={mutation.isPending}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>
                {mutation.isPending ? 'Saving…' : 'Save Note'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Bill detail + discount/surcharge ────────────────────────────────────────
//
// adjustBill() is blocked server-side once a period reaches PUBLISHED,
// PARTIALLY_PAID is NOT in that blocklist though — matched exactly, not
// guessed, so the UI never shows an action the API will actually reject.
const ADJUSTABLE_STATUSES = ['DRAFT', 'CALCULATED', 'REVIEW', 'PARTIALLY_PAID'];

function BillDetailModal({
  flat,
  canManage,
  periodStatus,
  onClose,
}: {
  flat: FlatRow;
  canManage: boolean;
  periodStatus?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [kind, setKind] = useState<'DISCOUNT' | 'SURCHARGE'>('DISCOUNT');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');

  // Fresh, authoritative figures straight from the bill row — the statement
  // list can be a few seconds stale by the time an admin taps in. GET
  // /billing/bills/:id is admin/accountant-only, so residents skip this
  // fetch entirely and the breakdown below falls back to the `flat` prop,
  // which already came from the statement endpoint every member can read.
  const { data: bill, isLoading } = useQuery({
    queryKey: ['bill-detail', flat.billId],
    queryFn: () => billingApi.getBill(flat.billId),
    enabled: canManage,
  });

  // Pre-fill the reason with whatever note already exists so submitting
  // doesn't silently wipe it — adjustBill() overwrites notes wholesale.
  React.useEffect(() => {
    if (bill && !reason) setReason(bill.notes ?? '');
  }, [bill]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAdjust = canManage && !!periodStatus && ADJUSTABLE_STATUSES.includes(periodStatus);

  const mutation = useMutation({
    mutationFn: () => {
      const amount = parseFloat(amountText);
      const signed = kind === 'DISCOUNT' ? -Math.abs(amount) : Math.abs(amount);
      return billingApi.adjustBill(flat.billId, signed, reason.trim());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-sheet'] });
      qc.invalidateQueries({ queryKey: ['bill-detail', flat.billId] });
      Alert.alert('Applied', `${kind === 'DISCOUNT' ? 'Discount' : 'Surcharge'} applied to Flat ${flat.flatCode}.`);
      onClose();
    },
    onError: (e: any) =>
      Alert.alert('Error', e?.response?.data?.message ?? 'Failed to apply adjustment.'),
  });

  const parsedAmount = parseFloat(amountText);
  const canSubmit = !isNaN(parsedAmount) && parsedAmount > 0 && reason.trim().length > 0;

  const maintenance = toNum(bill?.baseAmount ?? flat.generalMaintenance);
  const water = toNum(bill?.waterCharges ?? flat.waterCharges);
  const lateFee = toNum(bill?.lateFee ?? flat.lateFee);
  const adjustments = toNum(bill?.adjustments ?? flat.adjustments);
  const otherCharges = toNum(bill?.otherCharges ?? flat.otherCharges);
  const arrears = toNum(flat.arrears); // statement-only; not on the raw bill
  // `bill` is undefined for residents (the fetch is admin-only, gated by
  // `enabled: canManage` above) — fall back to the statement row's figures
  // in that case. Checking `bill` presence explicitly, rather than `||`
  // against toNum(...), matters here: a genuinely-zero totalAmount/
  // pendingAmount (e.g. a fully-discounted or fully-paid bill) is falsy
  // and would otherwise wrongly trigger the flat.* fallback even though
  // the live bill data is right there.
  const total = bill ? toNum(bill.totalAmount) : flat.totalPayable;
  const paid = bill ? toNum(bill.paidAmount) : (flat.isPaid ? flat.totalPayable : 0);
  const due = bill ? toNum(bill.pendingAmount) : (flat.isPaid ? 0 : flat.totalPayable);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe} edges={['top']}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalTitle}>Flat {flat.flatCode}</Text>
            {flat.residentName && <Text style={styles.modalSub}>{flat.residentName}</Text>}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {isLoading ? (
              <LoadingState message="Loading bill…" />
            ) : (
              <>
                <StatusBadge
                  label={flat.isPaid ? 'PAID' : 'PENDING'}
                  variant={flat.isPaid ? 'success' : 'warning'}
                />

                {/* Breakdown */}
                <View style={styles.breakdownCard}>
                  <BreakdownRow label="Maintenance" value={maintenance} />
                  {water > 0 && <BreakdownRow label="Water Charges" value={water} tint={colors.info} />}
                  {lateFee > 0 && <BreakdownRow label="Late Fee" value={lateFee} tint={colors.error} />}
                  {arrears > 0 && <BreakdownRow label="Arrears (earlier periods)" value={arrears} tint={colors.error} />}
                  {otherCharges > 0 && <BreakdownRow label="Other Charges" value={otherCharges} />}
                  {adjustments !== 0 && (
                    <BreakdownRow
                      label={adjustments < 0 ? 'Discount' : 'Surcharge'}
                      value={adjustments}
                      tint={adjustments < 0 ? colors.success : colors.error}
                      signed
                    />
                  )}
                  <View style={styles.breakdownDivider} />
                  <BreakdownRow label="Final Amount" value={total + arrears} bold />
                </View>

                {/* Payment summary */}
                <View style={styles.breakdownCard}>
                  <BreakdownRow label="Paid" value={paid} tint={colors.success} />
                  <BreakdownRow label="Due" value={due + arrears} tint={due + arrears > 0 ? colors.warning : colors.success} bold />
                </View>

                {/* Current note */}
                {(bill?.notes ?? flat.notes) ? (
                  <View style={styles.noteDisplay}>
                    <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
                    <Text style={styles.noteText}>{bill?.notes ?? flat.notes}</Text>
                  </View>
                ) : null}

                {/* Discount / surcharge action */}
                {canAdjust && !showAdjustForm && (
                  <TouchableOpacity
                    style={styles.adjustToggleBtn}
                    onPress={() => setShowAdjustForm(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="pricetag-outline" size={16} color={colors.primary} />
                    <Text style={styles.adjustToggleText}>Apply Discount / Surcharge</Text>
                  </TouchableOpacity>
                )}

                {canManage && !canAdjust && (
                  <View style={styles.disabledNote}>
                    <Ionicons name="lock-closed-outline" size={13} color={colors.textTertiary} />
                    <Text style={styles.disabledNoteText}>
                      Adjustments are only allowed before a period is fully paid or closed.
                    </Text>
                  </View>
                )}

                {showAdjustForm && (
                  <View style={styles.adjustForm}>
                    <View style={styles.kindRow}>
                      <TouchableOpacity
                        style={[styles.kindBtn, kind === 'DISCOUNT' && styles.kindBtnDiscount]}
                        onPress={() => setKind('DISCOUNT')}
                      >
                        <Text style={[styles.kindText, kind === 'DISCOUNT' && styles.kindTextDiscount]}>
                          Discount
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.kindBtn, kind === 'SURCHARGE' && styles.kindBtnSurcharge]}
                        onPress={() => setKind('SURCHARGE')}
                      >
                        <Text style={[styles.kindText, kind === 'SURCHARGE' && styles.kindTextSurcharge]}>
                          Surcharge
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.fieldLabel}>Amount (₹)</Text>
                    <TextInput
                      style={styles.amountInput}
                      value={amountText}
                      onChangeText={(v) => setAmountText(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                    />

                    {!isNaN(parsedAmount) && parsedAmount > 0 && (
                      <Text style={styles.previewText}>
                        New total: {inr(total + (kind === 'DISCOUNT' ? -parsedAmount : parsedAmount))}
                      </Text>
                    )}

                    <Text style={styles.fieldLabel}>
                      Reason <Text style={{ color: colors.textTertiary }}>— replaces this bill&apos;s note</Text>
                    </Text>
                    <TextInput
                      style={styles.reasonInput}
                      value={reason}
                      onChangeText={setReason}
                      placeholder="e.g. Early payment discount agreed with committee"
                      placeholderTextColor={colors.textTertiary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />

                    <View style={styles.adjustActions}>
                      <TouchableOpacity
                        style={styles.adjustCancelBtn}
                        onPress={() => { setShowAdjustForm(false); setAmountText(''); }}
                      >
                        <Text style={styles.adjustCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.adjustSubmitBtn,
                          (!canSubmit || mutation.isPending) && { opacity: 0.6 },
                        ]}
                        onPress={() => mutation.mutate()}
                        disabled={!canSubmit || mutation.isPending}
                      >
                        <Text style={styles.adjustSubmitText}>
                          {mutation.isPending ? 'Applying…' : `Apply ${kind === 'DISCOUNT' ? 'Discount' : 'Surcharge'}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function BreakdownRow({
  label, value, tint, bold, signed,
}: { label: string; value: number; tint?: string; bold?: boolean; signed?: boolean }) {
  const display = signed
    ? `${value < 0 ? '−' : '+'}${inr(Math.abs(value))}`
    : inr(value);
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, bold && styles.breakdownLabelBold]}>{label}</Text>
      <Text
        style={[
          styles.breakdownValue,
          bold && styles.breakdownValueBold,
          tint ? { color: tint } : null,
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

// ── Flat row card ─────────────────────────────────────────────────────────────

function FlatCard({
  flat,
  onNotePress,
  onPress,
  canEditNotes,
}: {
  flat: FlatRow;
  onNotePress: (f: FlatRow) => void;
  onPress: (f: FlatRow) => void;
  canEditNotes: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.flatCard, flat.isPaid && styles.flatCardPaid]}
      onPress={() => onPress(flat)}
      activeOpacity={0.75}
    >
      {/* Status stripe */}
      <View style={[styles.stripe, { backgroundColor: flat.isPaid ? colors.success : colors.warning }]} />

      <View style={styles.flatCardBody}>
        {/* Header row — resident name + phone instead of the invoice number,
            which isn't something anyone scanning this sheet needs to see. */}
        <View style={styles.flatCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.flatCode}>Flat {flat.flatCode}</Text>
            {flat.residentName && (
              <Text style={styles.ownerName}>{flat.residentName}</Text>
            )}
            {flat.residentPhone && (
              <Text style={styles.buildingName}>{flat.residentPhone}</Text>
            )}
          </View>
          <View style={styles.flatCardRight}>
            <StatusBadge
              label={flat.isPaid ? 'PAID' : 'PENDING'}
              variant={flat.isPaid ? 'success' : 'warning'}
            />
          </View>
        </View>

        {/* Amount row */}
        <View style={styles.amountRow}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Maintenance</Text>
            <Text style={styles.amountValue}>{inr(flat.generalMaintenance)}</Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Water</Text>
            <Text style={[styles.amountValue, { color: colors.info }]}>
              {inr(flat.waterCharges)}
            </Text>
          </View>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Total</Text>
            <Text style={[styles.amountValue, { color: flat.isPaid ? colors.success : colors.warning }]}>
              {inr(flat.totalPayable)}
            </Text>
          </View>
        </View>

        {toNum(flat.arrears) > 0 && (
          <View style={styles.noteRow}>
            <Ionicons name="alert-circle-outline" size={13} color={colors.error} />
            <Text style={[styles.noteText, { color: colors.error }]}>
              Includes {inr(flat.arrears)} arrears from earlier periods
            </Text>
          </View>
        )}

        {/* Note (if any) */}
        {flat.notes && (
          <View style={styles.noteRow}>
            <Ionicons name="document-text-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.noteText} numberOfLines={2}>{flat.notes}</Text>
          </View>
        )}

        {/* Note button — admin only; residents get a read-only view */}
        {canEditNotes && (
          <TouchableOpacity style={styles.noteBtn} onPress={() => onNotePress(flat)} activeOpacity={0.7}>
            <Ionicons
              name={flat.notes ? 'create-outline' : 'add-circle-outline'}
              size={14}
              color={colors.primary}
            />
            <Text style={styles.noteBtnText}>
              {flat.notes ? 'Edit note' : 'Add note'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── PDF export ───────────────────────────────────────────────────────────────

/**
 * Landscape US Letter. expo-print's `orientation` option only takes effect on
 * iOS — Android ignores it — so a swapped width/height (792x612 instead of
 * 612x792) is the only way to guarantee landscape on both platforms.
 * Deliberately drops the invoice number column: nobody scanning a collection
 * sheet needs it, and resident name + phone are far more useful for chasing
 * payment.
 */
function buildSheetHtml(periodLabel: string, rows: FlatRow[]): string {
  const generated = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const totalCollected = rows.reduce((s, r) => s + (r.isPaid ? toNum(r.totalPayable) : 0), 0);
  const totalPending = rows.reduce((s, r) => s + (r.isPaid ? 0 : toNum(r.totalPayable)), 0);
  const paidCount = rows.filter((r) => r.isPaid).length;

  const body = rows
    .map((r) => `
      <tr>
        <td class="flat">${r.flatCode}</td>
        <td>${r.residentName || '—'}</td>
        <td class="mono">${r.residentPhone || '—'}</td>
        <td class="num">${inr(r.generalMaintenance)}</td>
        <td class="num">${inr(r.waterCharges)}</td>
        ${toNum(r.arrears) > 0 ? `<td class="num arrears">${inr(r.arrears)}</td>` : '<td class="num">—</td>'}
        <td class="num total">${inr(r.totalPayable)}</td>
        <td class="status ${r.isPaid ? 'paid' : 'pending'}">${r.isPaid ? 'PAID' : 'PENDING'}</td>
      </tr>`)
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: landscape; margin: 24px 28px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1E293B; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 3px solid #0D2147; padding-bottom: 10px; margin-bottom: 14px; }
  .head h1 { font-size: 19px; margin: 0; color: #0D2147; }
  .head .period { font-size: 13px; color: #4A5568; margin-top: 2px; }
  .head .gen { font-size: 10px; color: #94A3B8; text-align: right; }
  .summary { display: flex; gap: 26px; margin-bottom: 14px; }
  .summary div { font-size: 11px; color: #4A5568; }
  .summary b { display: block; font-size: 16px; color: #0D2147; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #0D2147; color: #fff; padding: 7px 9px;
       font-size: 9.5px; letter-spacing: .4px; text-transform: uppercase; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 9px; border-bottom: 1px solid #E2E8F0; }
  tr:nth-child(even) td { background: #F8FAFC; }
  td.flat { font-weight: 700; }
  td.mono { font-family: 'Courier New', monospace; font-size: 10.5px; }
  td.total { font-weight: 700; }
  td.arrears { color: #EF4444; }
  td.status { font-weight: 700; font-size: 9.5px; letter-spacing: .3px; }
  td.status.paid { color: #15803D; }
  td.status.pending { color: #92400E; }
  .foot { margin-top: 12px; font-size: 9px; color: #94A3B8; }
</style></head>
<body>
  <div class="head">
    <div><h1>Maintenance Collection Sheet</h1><div class="period">${periodLabel}</div></div>
    <div class="gen">Generated ${generated}<br/>NG Home · Powered by NovaGade</div>
  </div>
  <div class="summary">
    <div><b>${paidCount}/${rows.length}</b>Flats Paid</div>
    <div><b style="color:#15803D">${inr(totalCollected)}</b>Collected</div>
    <div><b style="color:#B45309">${inr(totalPending)}</b>Pending</div>
  </div>
  <table>
    <thead><tr>
      <th>Flat</th><th>Resident</th><th>Phone</th>
      <th class="num">Maintenance</th><th class="num">Water</th><th class="num">Arrears</th>
      <th class="num">Total</th><th>Status</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">${rows.length} flat${rows.length === 1 ? '' : 's'} · This document is for internal society use.</div>
</body></html>`;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function MaintenanceSheetScreen() {
  const qc = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterPaid, setFilterPaid] = useState<'ALL' | 'PAID' | 'PENDING'>('ALL');
  const [editingFlat, setEditingFlat] = useState<FlatRow | null>(null);
  const [selectedFlat, setSelectedFlat] = useState<FlatRow | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // PATCH /billing/bills/:billId/notes is ADMIN/ACCOUNTANT-only — residents read.
  const { user } = useAuth();
  const canEditNotes =
    user?.currentRole === 'SOCIETY_ADMIN' || user?.currentRole === 'SOCIETY_ACCOUNTANT';

  // Load billing periods — /billing/periods is admin/accountant-only and
  // 403s for residents, so residents get the resident-safe published-only
  // list instead. Both branches feed the same PeriodPicker/state below.
  const { data: periods = [] } = useQuery({
    queryKey: ['billing-periods-sheet', canEditNotes],
    // React Query v5 removed the onSuccess callback — the default period is
    // selected by the effect below instead.
    queryFn: async (): Promise<BillingPeriod[]> => {
      if (canEditNotes) {
        const res = await billingApi.getBillingPeriods({ limit: 24 });
        return res.data ?? [];
      }
      return billingApi.listPublishedPeriods();
    },
  });

  // Ensure we set a default when periods load
  React.useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) {
      const published = periods.find((p) => p.status === 'PUBLISHED');
      setSelectedPeriodId(published?.id ?? periods[0]?.id ?? null);
    }
  }, [periods, selectedPeriodId]);

  // Load maintenance sheet for selected period
  const { data: sheetData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['maintenance-sheet', selectedPeriodId],
    // There is no /sheet route — the statement endpoint is the flat-wise view,
    // and it is readable by every society member (residents included).
    queryFn: async () => {
      const res = await apiClient.get<{ data?: { statements?: FlatRow[] }; statements?: FlatRow[] }>(
        `/billing/periods/${selectedPeriodId}/statement`,
      );
      const body = (res.data as any)?.data ?? res.data;
      return (body?.statements ?? []) as FlatRow[];
    },
    enabled: !!selectedPeriodId,
  });

  const rows: FlatRow[] = sheetData ?? [];

  // Stats
  const totalFlats = rows.length;
  const paidFlats = rows.filter((r) => r.isPaid).length;
  const totalCollected = rows.reduce((s, r) => s + (r.isPaid ? toNum(r.totalPayable) : 0), 0);
  const totalPending = rows.reduce((s, r) => s + (r.isPaid ? 0 : toNum(r.totalPayable)), 0);

  // Filter + search
  const filtered = rows.filter((r) => {
    const matchSearch = !search.trim() || [r.flatCode, r.residentName ?? ''].join(' ').toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filterPaid === 'ALL' ||
      (filterPaid === 'PAID' && r.isPaid) ||
      (filterPaid === 'PENDING' && !r.isPaid);
    return matchSearch && matchFilter;
  });

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const handleDownloadPdf = async () => {
    if (filtered.length === 0) {
      Alert.alert('Nothing to export', 'There are no flats in the current view to include.');
      return;
    }
    setIsExporting(true);
    try {
      const label = selectedPeriod ? billingPeriodName(selectedPeriod) : 'Maintenance Sheet';
      const html = buildSheetHtml(label, filtered);
      // 792x612 is US Letter with width/height swapped — Print.Orientation
      // only takes effect on iOS, so this is what actually forces landscape
      // on Android too.
      const { uri } = await Print.printToFileAsync({ html, width: 792, height: 612 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${label} — Maintenance Sheet`,
        });
      } else {
        Alert.alert('Saved', 'PDF generated, but sharing isn’t available on this device.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to generate PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Maintenance Sheet"
        showBack
        rightAction={
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleDownloadPdf} hitSlop={8} disabled={isExporting}>
              {isExporting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="download-outline" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => refetch()} hitSlop={8}>
              <Ionicons name="refresh-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        }
      />

      {/* Period selector */}
      {periods.length > 0 && (
        <View style={styles.periodWrap}>
          <PeriodPicker
            periods={periods}
            selected={selectedPeriodId ?? ''}
            onSelect={setSelectedPeriodId}
          />
        </View>
      )}

      {/* Summary banner */}
      {rows.length > 0 && (
        <View style={styles.summaryBanner}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{paidFlats}/{totalFlats}</Text>
            <Text style={styles.summaryLabel}>Paid</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              {inrCompact(totalCollected)}
            </Text>
            <Text style={styles.summaryLabel}>Collected</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.warning }]}>
              {inrCompact(totalPending)}
            </Text>
            <Text style={styles.summaryLabel}>Pending</Text>
          </View>
        </View>
      )}

      {/* Search + filter */}
      <View style={styles.searchFilter}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search flat or owner…"
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterBtns}>
          {(['ALL', 'PAID', 'PENDING'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filterPaid === f && styles.filterBtnActive]}
              onPress={() => setFilterPaid(f)}
            >
              <Text style={[styles.filterBtnText, filterPaid === f && styles.filterBtnTextActive]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Notes modal */}
      {editingFlat && (
        <NotesModal flat={editingFlat} onClose={() => setEditingFlat(null)} />
      )}

      {/* Bill detail / discount modal */}
      {selectedFlat && (
        <BillDetailModal
          flat={selectedFlat}
          canManage={canEditNotes}
          periodStatus={selectedPeriod?.status}
          onClose={() => setSelectedFlat(null)}
        />
      )}

      {isLoading ? (
        <LoadingState message="Loading maintenance sheet…" />
      ) : !selectedPeriodId ? (
        <EmptyState icon="receipt-outline" title="No billing periods" description="Create a billing period first." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="home-outline"
          title={search ? 'No matches' : 'No flats found'}
          description={search ? 'Try a different search term.' : 'Bills may not have been generated for this period yet.'}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.flatId}
          renderItem={({ item }) => (
            <FlatCard
              flat={item}
              onNotePress={setEditingFlat}
              onPress={setSelectedFlat}
              canEditNotes={canEditNotes}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListFooterComponent={<View style={{ height: spacing['3xl'] }} />}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },

  periodWrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  periodRow: { paddingHorizontal: spacing.base, paddingVertical: spacing.sm, gap: spacing.sm },
  periodChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  periodChipText: { ...typography.labelSmall, color: colors.textSecondary },
  periodChipTextActive: { color: colors.primary },

  summaryBanner: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { ...typography.headingSmall, color: colors.text },
  summaryLabel: { ...typography.labelSmall, color: colors.textSecondary, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

  searchFilter: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: spacing.sm,
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
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.text,
    padding: 0,
  },
  filterBtns: { flexDirection: 'row', gap: spacing.sm },
  filterBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterBtnText: { ...typography.labelSmall, color: colors.textSecondary },
  filterBtnTextActive: { color: colors.primary },

  list: { padding: spacing.sm },

  flatCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  flatCardPaid: { borderColor: colors.secondaryLight },
  stripe: { width: 4, flexShrink: 0 },
  flatCardBody: { flex: 1, padding: spacing.md, gap: spacing.sm },

  flatCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  flatCardRight: { alignItems: 'flex-end' },

  flatCode: { ...typography.labelLarge, color: colors.text, fontWeight: '700' },
  buildingName: { ...typography.bodySmall, color: colors.textSecondary },
  ownerName: { ...typography.bodySmall, color: colors.textSecondary },

  amountRow: { flexDirection: 'row', gap: spacing.xl },
  amountItem: { gap: 2 },
  amountLabel: { ...typography.labelSmall, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  amountValue: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },

  noteRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  noteText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, lineHeight: 17 },

  noteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
  },
  noteBtnText: { ...typography.labelSmall, color: colors.primary },

  // Modal
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.headingSmall, color: colors.text },
  modalSub: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  modalContent: { padding: spacing.base, gap: spacing.base },
  noteHint: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 18 },
  noteInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { ...typography.labelLarge, color: '#fff' },

  // Bill detail breakdown
  breakdownCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.base,
    gap: 10,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { ...typography.bodyMedium, color: colors.textSecondary },
  breakdownLabelBold: { color: colors.text, fontWeight: '700' },
  breakdownValue: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  breakdownValueBold: { ...typography.headingSmall, fontWeight: '700' },
  breakdownDivider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },

  noteDisplay: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },

  adjustToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  adjustToggleText: { ...typography.labelLarge, color: colors.primary },

  disabledNote: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  disabledNoteText: { ...typography.bodySmall, color: colors.textTertiary, flex: 1, lineHeight: 16 },

  adjustForm: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  kindBtnDiscount: { backgroundColor: colors.successLight, borderColor: colors.success },
  kindBtnSurcharge: { backgroundColor: colors.errorLight, borderColor: colors.error },
  kindText: { ...typography.labelMedium, color: colors.textSecondary },
  kindTextDiscount: { color: colors.success, fontWeight: '700' },
  kindTextSurcharge: { color: colors.error, fontWeight: '700' },

  fieldLabel: { ...typography.labelSmall, color: colors.textSecondary, marginTop: 4 },
  amountInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
  },
  previewText: { ...typography.bodySmall, color: colors.textSecondary },
  reasonInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.bodyMedium,
    color: colors.text,
    minHeight: 72,
    textAlignVertical: 'top',
  },

  adjustActions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  adjustCancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  adjustCancelText: { ...typography.labelLarge, color: colors.textSecondary },
  adjustSubmitBtn: {
    flex: 2,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  adjustSubmitText: { ...typography.labelLarge, color: '#fff' },
});
