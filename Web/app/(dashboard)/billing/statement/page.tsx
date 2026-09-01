'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutList, Printer, Pencil, Check, X, MessageCircle } from 'lucide-react';
import { billingApi, societyApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function MaintenanceStatementPage() {
  const { activeMembership } = useAuth();
  const myFlatId = activeMembership?.flatId ?? null;
  const isAdmin =
    activeMembership?.role === 'SOCIETY_ADMIN' ||
    activeMembership?.role === 'SOCIETY_ACCOUNTANT';

  const queryClient = useQueryClient();

  /* Load list of published periods */
  const { data: periodsRaw, isLoading: periodsLoading } = useQuery({
    queryKey: ['published-periods'],
    queryFn: () => billingApi.listPublishedPeriods().then((r: any) => r.data ?? r),
  });

  const periods: any[] = Array.isArray(periodsRaw) ? periodsRaw : [];

  /* Default to most recent period */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activePeriodId = selectedId ?? periods[0]?.id ?? null;

  /* Load statement for selected period */
  const { data: statementRaw, isLoading: statementLoading } = useQuery({
    queryKey: ['period-statement', activePeriodId],
    queryFn: () => billingApi.getPeriodStatement(activePeriodId!).then((r: any) => r.data ?? r),
    enabled: !!activePeriodId,
  });

  const period = statementRaw?.period ?? null;
  const statements: any[] = statementRaw?.statements ?? [];

  /* Society config — for UPI ID in WhatsApp messages */
  const { data: configRaw } = useQuery({
    queryKey: ['society-config'],
    queryFn: () => societyApi.getConfig().then((r: any) => r.data ?? r),
    enabled: isAdmin,
  });
  const { data: societyRaw } = useQuery({
    queryKey: ['my-society'],
    queryFn: () => societyApi.getMySociety().then((r: any) => r.data ?? r),
    enabled: isAdmin,
  });
  const upiId: string = (configRaw?.additionalConfig as any)?.upiId ?? '';
  const societyName: string = societyRaw?.displayName ?? societyRaw?.name ?? 'Society';

  function buildWhatsAppLink(s: any) {
    const monthYear = period
      ? `${MONTH_NAMES[period.periodMonth]} ${period.periodYear}`
      : 'this month';
    const amount = s.totalPayable?.toLocaleString('en-IN') ?? s.totalPayable;
    let msg = `Hi ${s.residentName}, friendly reminder from ${societyName}: your maintenance for ${monthYear} (Flat ${s.flatCode}) of ₹${amount} is due.`;
    if (upiId) {
      msg += ` Please pay via UPI: ${upiId} and share the UTR for confirmation.`;
    }
    msg += ` Thank you! 🙏`;
    const phone = s.residentPhone?.replace(/\D/g, '');
    const fullPhone = phone?.startsWith('91') ? phone : `91${phone}`;
    return `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
  }

  /* Note editing state */
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  function startEdit(billId: string, currentNote: string | null) {
    setEditingBillId(billId);
    setNoteText(currentNote ?? '');
  }

  function cancelEdit() {
    setEditingBillId(null);
    setNoteText('');
  }

  async function saveNote(billId: string) {
    setSavingNote(true);
    try {
      await billingApi.updateBillNotes(billId, noteText.trim());
      await queryClient.invalidateQueries({ queryKey: ['period-statement', activePeriodId] });
      setEditingBillId(null);
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <>
      {/* Print styles — landscape, hide chrome */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm 10mm; }
          nav, aside, header, [data-sidebar], .no-print { display: none !important; }
          body { background: white !important; }
          table { font-size: 10px !important; }
          button { display: none !important; }
        }
      `}</style>
      <Header
        title="Maintenance Sheet"
        subtitle="Society-wide monthly maintenance statement"
      />
      <PageContainer className="space-y-6">
        {periodsLoading ? (
          <PageSpinner />
        ) : periods.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
            <LayoutList size={40} className="mx-auto mb-4 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No published statements yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Published maintenance statements will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Period selector */}
            <div className="no-print flex flex-wrap items-center gap-2">
              {periods.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                    (activePeriodId === p.id)
                      ? 'bg-primary-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700',
                  )}
                >
                  {MONTH_NAMES[p.periodMonth]} {p.periodYear}
                </button>
              ))}
            </div>

            {/* Period summary */}
            {period && (
              <div className="no-print grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Total Billed', value: formatCurrency(period.totalBilled), color: 'text-slate-900' },
                  { label: 'Collected', value: formatCurrency(period.totalCollected), color: 'text-green-700' },
                  { label: 'Pending', value: formatCurrency(period.totalPending), color: period.totalPending > 0 ? 'text-red-600' : 'text-green-700' },
                ].map(({ label, value, color }) => (
                  <Card key={label} padding="lg">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                    <p className={cn('mt-1 text-xl font-bold tabular-nums', color)}>{value}</p>
                  </Card>
                ))}
              </div>
            )}

            {/* Statement table */}
            {statementLoading && <PageSpinner />}
            {!statementLoading && statements.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                {/* Table header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {period
                        ? `${MONTH_NAMES[period.periodMonth]} ${period.periodYear} — Maintenance Statement`
                        : 'Maintenance Statement'}
                    </h3>
                    {period?.dueDate && (
                      <p className="mt-0.5 text-xs text-slate-500">Due: {formatDate(period.dueDate)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <Printer size={13} /> Print / PDF
                  </button>
                </div>

                {/* My flat highlight notice (residents only) */}
                {myFlatId && statements.some((s) => s.flatId === myFlatId) && (
                  <div className="px-4 py-2 bg-primary-50 border-b border-primary-100 text-xs text-primary-700 font-medium">
                    🏠 Your flat is highlighted in blue below
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Flat</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Resident</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Maintenance</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Prev (KL)</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Curr (KL)</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Units</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Rate/KL</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Water</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Discount</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Late Fee</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Arrears</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Total Payable</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Status</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap min-w-[160px]">
                          Note {isAdmin && <span className="ml-1 font-normal text-slate-400 normal-case">(admin only)</span>}
                        </th>
                        {isAdmin && (
                          <th className="no-print px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                            Remind
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {statements.map((s: any) => {
                        const isMyFlat = s.flatId === myFlatId;
                        const discount = s.adjustments < 0 ? Math.abs(s.adjustments) : 0;
                        const isEditing = editingBillId === s.billId;
                        return (
                          <tr
                            key={s.billId}
                            className={cn(
                              'hover:bg-slate-50 transition-colors',
                              isMyFlat ? 'bg-primary-50/60 hover:bg-primary-50' : '',
                              s.isPaid ? 'opacity-70' : '',
                            )}
                          >
                            <td className={cn('px-3 py-2.5 font-bold whitespace-nowrap', isMyFlat ? 'text-primary-700' : 'text-slate-900')}>
                              {s.flatCode}
                              {isMyFlat && <span className="ml-1 text-[10px] text-primary-500">(You)</span>}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap max-w-[110px] truncate">{s.residentName}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{formatCurrency(s.generalMaintenance)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-400 whitespace-nowrap">
                              {s.waterReading ? s.waterReading.openingReading.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-400 whitespace-nowrap">
                              {s.waterReading ? s.waterReading.closingReading.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              {s.waterReading ? s.waterReading.consumption.toFixed(3) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-400 whitespace-nowrap">
                              {s.waterReading?.effectiveRate ? formatCurrency(s.waterReading.effectiveRate) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-blue-600 whitespace-nowrap">
                              {s.waterCharges > 0 ? formatCurrency(s.waterCharges) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-green-600 whitespace-nowrap">
                              {discount > 0 ? `−${formatCurrency(discount)}` : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">
                              {s.lateFee > 0 ? formatCurrency(s.lateFee) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-red-600 whitespace-nowrap">
                              {s.arrears > 0 ? formatCurrency(s.arrears) : '—'}
                            </td>
                            <td className={cn('px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap', isMyFlat ? 'text-primary-700' : 'text-slate-900')}>
                              {formatCurrency(s.totalPayable)}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                                s.isPaid
                                  ? 'bg-green-100 text-green-700'
                                  : s.isPublished
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-600',
                              )}>
                                {s.isPaid ? '✓ Paid' : s.isPublished ? 'Unpaid' : 'Draft'}
                              </span>
                            </td>

                            {/* Note column */}
                            <td className="px-3 py-2 min-w-[200px]">
                              {isAdmin ? (
                                isEditing ? (
                                  <div className="flex items-start gap-1.5">
                                    <textarea
                                      autoFocus
                                      value={noteText}
                                      onChange={(e) => setNoteText(e.target.value)}
                                      placeholder="Add a note…"
                                      rows={2}
                                      className="w-full rounded border border-primary-300 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                                    />
                                    <div className="flex flex-col gap-1 mt-0.5">
                                      <button
                                        onClick={() => saveNote(s.billId)}
                                        disabled={savingNote}
                                        className="flex h-6 w-6 items-center justify-center rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                                        title="Save note"
                                      >
                                        <Check size={12} />
                                      </button>
                                      <button
                                        onClick={cancelEdit}
                                        disabled={savingNote}
                                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                                        title="Cancel"
                                      >
                                        <X size={12} />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="group flex items-start gap-1.5 cursor-pointer"
                                    onClick={() => startEdit(s.billId, s.notes)}
                                  >
                                    <span className={cn(
                                      'flex-1 text-xs leading-snug',
                                      s.notes ? 'text-slate-600' : 'text-slate-300 italic',
                                    )}>
                                      {s.notes || 'Add note…'}
                                    </span>
                                    <Pencil
                                      size={11}
                                      className="mt-0.5 shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                                    />
                                  </div>
                                )
                              ) : (
                                /* Resident: read-only */
                                <span className={cn(
                                  'text-xs leading-snug',
                                  s.notes ? 'text-slate-600' : 'text-slate-300',
                                )}>
                                  {s.notes || '—'}
                                </span>
                              )}
                            </td>

                            {/* WhatsApp reminder (admin only, no-print) */}
                            {isAdmin && (
                              <td className="no-print px-3 py-2 text-center whitespace-nowrap">
                                {!s.isPaid && s.residentPhone ? (
                                  <a
                                    href={buildWhatsAppLink(s)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Send WhatsApp reminder to ${s.residentName}`}
                                    className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                                  >
                                    <MessageCircle size={13} />
                                  </a>
                                ) : (
                                  <span className="text-slate-200">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-sm">
                        <td className="px-3 py-3 text-slate-700" colSpan={2}>Totals</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatCurrency(statements.reduce((s, r) => s + r.generalMaintenance, 0))}
                        </td>
                        <td colSpan={4} />
                        <td className="px-3 py-3 text-right tabular-nums text-blue-600">
                          {formatCurrency(statements.reduce((s, r) => s + r.waterCharges, 0))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-green-600">
                          {formatCurrency(statements.reduce((s, r) => s + Math.abs(Math.min(0, r.adjustments)), 0))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-amber-700">
                          {formatCurrency(statements.reduce((s, r) => s + r.lateFee, 0))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-red-600">
                          {formatCurrency(statements.reduce((s, r) => s + r.arrears, 0))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-900">
                          {formatCurrency(statements.reduce((s, r) => s + r.totalPayable, 0))}
                        </td>
                        <td colSpan={isAdmin ? 3 : 2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Legend */}
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    <strong>Total Payable</strong> = Maintenance + Water − Discount + Late Fee + Arrears (unpaid from prior months).
                    Paid flats are greyed out.
                    {isAdmin && <> · Click any <strong>Note</strong> cell to add or edit a per-flat comment.</>}
                  </p>
                </div>
              </div>
            )}

            {!statementLoading && activePeriodId && statements.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
                No bills found for this period.
              </div>
            )}
          </>
        )}
      </PageContainer>
    </>
  );
}
