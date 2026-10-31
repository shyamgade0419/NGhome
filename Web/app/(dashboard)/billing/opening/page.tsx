'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, CheckCircle2, Download, Lock, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { billingApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { downloadCsv, toCsv } from '@/lib/csv';
import {
  parseMoney,
  parseOpeningSheet,
  type OpeningBalances,
  type OpeningInputRow,
  type OpeningPlanItem,
  type OpeningRow,
  type OpeningSaveResult,
  type ParsedLine,
} from '@/lib/openingBalances';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatDate, parseDecimalLike, cn } from '@/lib/utils';

/** Rupees, with paise when there are any (₹4,000.50, not ₹4,000.5). */
function formatCurrency(value: unknown): string {
  const n = parseDecimalLike(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const today = () => new Date().toISOString().slice(0, 10);

const ACTION_LABEL: Record<OpeningPlanItem['action'], { text: string; variant: 'success' | 'info' | 'warning' | 'danger' | 'muted' }> = {
  CREATE: { text: 'New', variant: 'success' },
  UPDATE: { text: 'Changed', variant: 'info' },
  REMOVE: { text: 'Removed', variant: 'warning' },
  UNCHANGED: { text: 'Same', variant: 'muted' },
  REJECTED: { text: 'Problem', variant: 'danger' },
};

/** What to tell the admin after a save: a count, and each row that was refused with its reason. */
function reportSave(res: OpeningSaveResult) {
  const s = res.summary;
  const done = s.created + s.updated + s.removed;
  if (s.rejected === 0) toast.success(done === 0 ? 'Nothing needed saving' : `Saved: ${done} flat${done === 1 ? '' : 's'}`);
  else toast(`${done} saved, ${s.rejected} not saved`, { icon: '⚠️' });
}

/* ─── Import from a spreadsheet ───────────────────────────────────────────── */

function ImportModal({ data, asOfDate, onClose }: { data: OpeningBalances; asOfDate: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [fileName, setFileName] = useState('');
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [preview, setPreview] = useState<OpeningSaveResult | null>(null);
  const [done, setDone] = useState<OpeningSaveResult | null>(null);

  const sendable: OpeningInputRow[] = lines
    .filter((l) => !l.error && l.amount !== null)
    .map((l) => ({ flatCode: l.flatCode, amount: l.amount as number, ...(l.note ? { note: l.note } : {}) }));

  const check = useMutation({
    mutationFn: (rows: OpeningInputRow[]) => billingApi.saveOpeningBalances({ asOfDate, rows, dryRun: true }).then((r) => r.data),
    onSuccess: (res) => { setPreview(res); setStep('preview'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not check the file'),
  });

  const save = useMutation({
    mutationFn: () => billingApi.saveOpeningBalances({ asOfDate, rows: sendable }).then((r) => r.data),
    onSuccess: (res) => {
      setDone(res);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
      reportSave(res);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const records: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        const parsed = parseOpeningSheet(records);
        if (parsed.missing) { toast.error(parsed.missing); return; }
        if (parsed.lines.length === 0) { toast.error('No flat in the file has an amount.'); return; }
        setLines(parsed.lines);
        const rows = parsed.lines
          .filter((l) => !l.error && l.amount !== null)
          .map((l) => ({ flatCode: l.flatCode, amount: l.amount as number, ...(l.note ? { note: l.note } : {}) }));
        if (rows.length === 0) { setStep('preview'); setPreview(null); return; }
        check.mutate(rows);
      } catch {
        toast.error("Could not read that file — make sure it's a valid CSV or Excel file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadTemplate = () => {
    const rows = data.rows.map((r) => [r.flatCode, r.amount ?? '', r.note ?? '']);
    downloadCsv('ng-home-opening-balances.csv', toCsv(['Flat', 'Amount', 'Note'], rows.length ? rows : [['A-101', '12000', 'Paper ledger, to March']]));
  };

  const problems = preview ? preview.results.filter((r) => r.action === 'REJECTED') : [];
  const willSave = preview ? preview.summary.created + preview.summary.updated + preview.summary.removed : 0;
  const fileProblems = lines.filter((l) => l.error);
  // The server numbers the rows it was sent; the person reads the file, so show the file's own line numbers.
  const sentLines = lines.filter((l) => !l.error && l.amount !== null);
  const fileLine = (row: number) => sentLines[row - 1]?.line ?? row;
  const shown = [
    ...fileProblems.map((l) => ({ line: l.line, flatCode: l.flatCode, amount: null as string | null, error: l.error, plan: null as OpeningPlanItem | null })),
    ...(preview?.results ?? []).map((r) => ({ line: fileLine(r.row), flatCode: r.flatCode, amount: r.amount as string | null, error: null as string | null, plan: r })),
  ].sort((a, b) => a.line - b.line);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Import opening balances</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p>
                One row per flat with what it owed on <strong>{formatDate(asOfDate)}</strong>: the <strong>Flat</strong> code and the{' '}
                <strong>Amount</strong>, and a <strong>Note</strong> if you like. Flats you leave blank are skipped.
              </p>
              <button onClick={downloadTemplate} className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary-600 hover:underline">
                <Download size={14} /> Download a sheet with all {data.rows.length} of your flats
              </button>
            </div>

            <div
              className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition-colors hover:border-primary-400"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
            >
              <Upload size={28} className="mx-auto mb-3 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Click to choose a file, or drag one here</p>
              <p className="mt-1 text-xs text-slate-400">.csv, .xlsx, or .xls</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
            {check.isPending && <p className="text-center text-sm text-slate-500">Checking the file…</p>}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">{fileName}</span>
              {preview && (
                <span className="font-medium">
                  <span className="text-green-600">{willSave} to save</span>
                  {preview.summary.unchanged > 0 && <span className="text-slate-500"> · {preview.summary.unchanged} already the same</span>}
                  {problems.length + fileProblems.length > 0 && <span className="text-red-500"> · {problems.length + fileProblems.length} with a problem</span>}
                </span>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200">
              <Table>
                <Thead>
                  <Tr><Th>Row</Th><Th>Flat</Th><Th>Amount</Th><Th>What happens</Th></Tr>
                </Thead>
                <Tbody>
                  {shown.map((s) => (
                    <Tr key={s.line}>
                      <Td>{s.line}</Td>
                      <Td>{s.flatCode || '—'}</Td>
                      <Td>{s.plan && s.plan.action !== 'REJECTED' ? formatCurrency(s.plan.amount) : '—'}</Td>
                      <Td>
                        {s.error ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500"><AlertCircle size={13} /> {s.error}</span>
                        ) : s.plan ? (
                          <>
                            <Badge variant={ACTION_LABEL[s.plan.action].variant}>{ACTION_LABEL[s.plan.action].text}</Badge>
                            {s.plan.message && <span className="ml-2 text-xs text-slate-500">{s.plan.message}</span>}
                            {s.plan.action === 'UPDATE' && s.plan.previous && <span className="ml-2 text-xs text-slate-500">was {formatCurrency(s.plan.previous)}</span>}
                          </>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>

            {problems.length + fileProblems.length > 0 && (
              <p className="text-xs text-slate-500">
                Rows with a problem are skipped. Fix them in your file and upload it again, or save just the {willSave} that are ready.
              </p>
            )}

            <div className="flex justify-between gap-3">
              <Button variant="secondary" onClick={() => { setStep('upload'); setPreview(null); setLines([]); }}>Back</Button>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={willSave === 0}>
                Save {willSave} balance{willSave === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && done && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
              <CheckCircle2 size={22} className="text-green-600" />
              <p className="text-sm font-semibold text-green-800">
                {done.summary.created} added · {done.summary.updated} changed · {done.summary.removed} removed
              </p>
            </div>
            {done.summary.rejected > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="mb-2 text-sm font-semibold text-red-700">{done.summary.rejected} not saved</p>
                <ul className="space-y-1">
                  {done.results.filter((r) => r.action === 'REJECTED').map((r) => (
                    <li key={r.row} className="text-xs text-red-600">Row {fileLine(r.row)} ({r.flatCode || '—'}): {r.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Correct a locked balance (admin) ─────────────────────────────────────── */

function CorrectModal({ row, onClose }: { row: OpeningRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const paid = row ? parseFloat(row.paidAmount) : 0;
  const parsed = parseMoney(amount);
  const problem =
    parsed === null || Number.isNaN(parsed) || parsed <= 0 ? 'Enter what the flat really owed.'
    : row && parsed === parseFloat(row.amount ?? '0') ? 'That is the amount already recorded.'
    : reason.trim().length < 3 ? 'Give a short reason.'
    : null;

  const correct = useMutation({
    mutationFn: () => billingApi.correctOpeningBalance(row!.flatId, { amount: parsed as number, reason: reason.trim() }),
    onSuccess: (res: any) => {
      const moved = parseFloat(res.data?.movedToAdvance ?? '0');
      toast.success(moved > 0 ? `Corrected. ${formatCurrency(moved)} was paid in excess and is now the flat's advance.` : 'Corrected');
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
      setAmount(''); setReason('');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not correct the balance'),
  });

  return (
    <Modal open={!!row} onClose={onClose} title={row ? `Correct the opening balance — ${row.flatCode}` : 'Correct'}>
      {row && (
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Recorded as <strong>{formatCurrency(row.amount ?? 0)}</strong>, of which <strong>{formatCurrency(paid)}</strong> has been paid.
            If the true amount is less than what was paid, the extra becomes the flat&apos;s <strong>advance</strong>; if it is more, the flat owes the rest.
            The old and new amounts and your reason are kept in the audit log.
          </p>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">What the flat really owed (₹)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Reason</span>
            <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ledger page 14 was misread" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </label>
          {problem && <p className="text-xs text-red-600">{problem}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => correct.mutate()} loading={correct.isPending} disabled={!!problem}>Correct balance</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

interface Edit { amount?: string; note?: string }

export default function OpeningBalancesPage() {
  const qc = useQueryClient();
  const { activeMembership } = useAuth();
  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN';
  const [correcting, setCorrecting] = useState<OpeningRow | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['opening-balances'],
    queryFn: () => billingApi.getOpeningBalances().then((r: any) => (r.data ?? r) as OpeningBalances),
  });

  const [asOf, setAsOf] = useState<string>('');
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [search, setSearch] = useState('');
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const asOfDate = asOf || (data?.asOfDate ? data.asOfDate.slice(0, 10) : today());

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (onlyWithBalance && r.amount === null) return false;
      return !q || r.flatCode.toLowerCase().includes(q) || (r.residentName ?? '').toLowerCase().includes(q);
    });
  }, [data, search, onlyWithBalance]);

  /** A row is changed when its text differs from what is stored. */
  const changes = useMemo(() => {
    const out: OpeningInputRow[] = [];
    for (const r of data?.rows ?? []) {
      const e = edits[r.flatId];
      if (!e || r.locked) continue;
      const stored = r.amount === null ? '' : String(parseFloat(r.amount));
      const amountText = e.amount ?? stored;
      const parsed = parseMoney(amountText);
      if (Number.isNaN(parsed)) continue;
      const amount = parsed ?? 0;
      const noteChanged = e.note !== undefined && e.note.trim() !== (r.note ?? '');
      const amountChanged = amount !== (r.amount === null ? 0 : parseFloat(r.amount));
      if (!amountChanged && !noteChanged) continue;
      if (amount === 0 && r.amount === null) continue;
      out.push({ flatCode: r.flatCode, amount, ...(e.note !== undefined ? { note: e.note.trim() } : {}) });
    }
    return out;
  }, [data, edits]);

  const invalid = useMemo(
    () => (data?.rows ?? []).filter((r) => edits[r.flatId]?.amount !== undefined && Number.isNaN(parseMoney(edits[r.flatId].amount))),
    [data, edits],
  );

  const save = useMutation({
    mutationFn: () => billingApi.saveOpeningBalances({ asOfDate, rows: changes }).then((r) => r.data),
    onSuccess: (res) => {
      reportSave(res);
      for (const r of res.results.filter((x) => x.action === 'REJECTED')) toast.error(`${r.flatCode}: ${r.message}`);
      setEdits({});
      qc.invalidateQueries({ queryKey: ['opening-balances'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save'),
  });

  const setEdit = (flatId: string, patch: Edit) => setEdits((prev) => ({ ...prev, [flatId]: { ...prev[flatId], ...patch } }));

  if (isLoading || !data) return <PageSpinner />;

  const t = data.totals;
  return (
    <>
      <Header
        title="Opening Balances"
        subtitle="What each flat owed before it moved to NG Home from paper or Excel"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload size={14} className="mr-1.5" /> Import CSV/Excel
            </Button>
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={changes.length === 0 || invalid.length > 0}>
              {changes.length === 0 ? 'Save' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        }
      />
      <PageContainer className="space-y-4">
        <Card className="space-y-2 text-sm text-slate-600">
          <div className="flex items-start gap-3">
            <BookOpen size={18} className="mt-0.5 shrink-0 text-primary-600" />
            <div className="space-y-1.5">
              <p>
                Enter each flat&apos;s unpaid amount from your old records. It becomes the flat&apos;s oldest due: a payment clears it
                before any new month, and it shows as <strong>arrears</strong> on the Maintenance Sheet and in the resident&apos;s bills.
                No fine is added to it.
              </p>
              <p>A balance can be changed or removed until a payment is made against it. After that it is locked, and only the admin can correct it, with a reason.</p>
              {data.startedBilling && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  A month has already been billed. Balances entered now are added to what residents see as arrears on those bills.
                </p>
              )}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Flats with a balance', `${t.withBalance} of ${t.flats}`],
            ['Opening dues', formatCurrency(t.opening)],
            ['Paid so far', formatCurrency(t.paid)],
            ['Still owed', formatCurrency(t.pending)],
          ].map(([label, value]) => (
            <Card key={label} padding="sm">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
            </Card>
          ))}
        </div>

        <Card className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">Records are correct up to</span>
            <input
              type="date"
              value={asOfDate}
              max={today()}
              onChange={(e) => setAsOf(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="block text-xs font-medium text-slate-500">Find a flat or resident</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="A-101"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyWithBalance} onChange={(e) => setOnlyWithBalance(e.target.checked)} />
            Only flats with a balance
          </label>
        </Card>

        <Card padding="none">
          <Table>
            <Thead>
              <Tr>
                <Th>Flat</Th>
                <Th>Resident</Th>
                <Th>Opening balance (₹)</Th>
                <Th>Note</Th>
                <Th>Paid</Th>
                <Th>Still owed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.length === 0 && (
                <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No flat matches.</Td></Tr>
              )}
              {rows.map((r) => {
                const e = edits[r.flatId] ?? {};
                const amountText = e.amount ?? (r.amount === null ? '' : String(parseFloat(r.amount)));
                const bad = e.amount !== undefined && Number.isNaN(parseMoney(e.amount));
                return (
                  <Tr key={r.flatId}>
                    <Td className="font-medium">{r.flatCode}</Td>
                    <Td className="text-slate-600">{r.residentName ?? '—'}</Td>
                    <Td>
                      {r.locked ? (
                        <span className="inline-flex items-center gap-1.5 font-medium" title={r.locked}>
                          <Lock size={13} className="text-slate-400" /> {formatCurrency(r.amount ?? 0)}
                          {isAdmin && (
                            <button onClick={() => setCorrecting(r)} className="ml-1 text-xs font-medium text-primary-600 hover:underline" aria-label={`Correct the opening balance of ${r.flatCode}`}>
                              Correct
                            </button>
                          )}
                        </span>
                      ) : (
                        <input
                          inputMode="decimal"
                          aria-label={`Opening balance for ${r.flatCode}`}
                          value={amountText}
                          placeholder="0"
                          onChange={(ev) => setEdit(r.flatId, { amount: ev.target.value })}
                          className={cn(
                            'w-32 rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2',
                            bad ? 'border-red-400 focus:ring-red-300' : 'border-slate-300 focus:ring-primary-400',
                          )}
                        />
                      )}
                    </Td>
                    <Td>
                      {r.locked ? (
                        <span className="text-xs text-slate-500">{r.note ?? '—'}</span>
                      ) : (
                        <input
                          aria-label={`Note for ${r.flatCode}`}
                          value={e.note ?? r.note ?? ''}
                          maxLength={200}
                          placeholder="Optional"
                          onChange={(ev) => setEdit(r.flatId, { note: ev.target.value })}
                          className="w-full min-w-[10rem] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                        />
                      )}
                    </Td>
                    <Td className="text-green-700">{r.amount === null ? '—' : formatCurrency(r.paidAmount)}</Td>
                    <Td className={r.amount !== null && parseFloat(r.pendingAmount) > 0 ? 'font-medium text-red-600' : ''}>
                      {r.amount === null ? '—' : formatCurrency(r.pendingAmount)}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Card>
        <p className="text-xs text-slate-500">
          Clear an amount (or enter 0) to remove a balance. A padlock means a payment has been made against it, so it can no longer be edited here; the admin can use Correct to fix it with a reason.
        </p>
      </PageContainer>

      <CorrectModal row={correcting} onClose={() => setCorrecting(null)} />
      {showImport && <ImportModal data={data} asOfDate={asOfDate} onClose={() => setShowImport(false)} />}
    </>
  );
}
