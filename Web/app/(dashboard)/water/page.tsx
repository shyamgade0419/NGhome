'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Droplets, Calculator, CheckCircle2, ChevronDown, Info, Zap, Truck, Building2,
} from 'lucide-react';
import { waterApi, billingApi, societyApi } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/AuthContext';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageSpinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { billingPeriodLabel } from '@/lib/types';

/* ── Types ────────────────────────────────────────────────────── */
interface FlatReading {
  flatId: string;
  flatCode: string;
  openingReading: string;
  closingReading: string;
  notes: string;
}

interface AllocationResult {
  costBreakdown: {
    municipalWaterBill: number;
    tankerCost: number;
    commonElectricityBill: number;
    electricityWaterPercent: number;
    electricityWaterCost: number;
    totalWaterCost: number;
  };
  totalUnits: number;
  ratePerUnit: number;
  flatCount: number;
  flatReadings: Array<{
    flatId: string;
    flatCode: string;
    openingReading: number;
    closingReading: number;
    consumption: number;
    ratePerUnit: number;
    charge: number;
  }>;
}

/* ── Cost Input Card ──────────────────────────────────────────── */
function CostCard({
  icon: Icon,
  label,
  hint,
  value,
  onChange,
  suffix,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  iconColor?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', iconColor ?? 'bg-blue-50')}>
          <Icon size={16} className={cn(iconColor ? 'text-white' : 'text-blue-600')} />
        </div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
      </div>
      <p className="text-xs text-slate-500">{hint}</p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type="number"
          min="0"
          className="flex-1"
          placeholder="0"
        />
        {suffix && <span className="text-sm text-slate-500 font-medium">{suffix}</span>}
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function WaterBillingPage() {
  const { activeMembership, user } = useAuth();
  const isAdmin = activeMembership?.role === 'SOCIETY_ADMIN' ||
    activeMembership?.role === 'SOCIETY_ACCOUNTANT' ||
    !!user?.isPlatformAdmin;

  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [costs, setCosts] = useState({
    municipalWaterBill: '',
    tankerCost: '',
    commonElectricityBill: '',
    electricityWaterPercent: '30',
  });
  const [readings, setReadings] = useState<FlatReading[]>([]);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [activeTab, setActiveTab] = useState<'entry' | 'summary'>('entry');

  /* Billing periods */
  const { data: periodsData, isLoading: loadingPeriods } = useQuery({
    queryKey: ['billing-periods'],
    queryFn: () => billingApi.listPeriods({ limit: 24 }).then((r: any) => r.data ?? r),
    enabled: isAdmin,
  });

  /* All flats */
  const { data: flatsData, isLoading: loadingFlats } = useQuery({
    queryKey: ['flats'],
    queryFn: () => societyApi.flats({ limit: 200 }).then((r: any) => r.data ?? r),
    enabled: isAdmin,
  });

  /* Existing water readings for selected period */
  const { data: existingReadings, refetch: refetchSummary } = useQuery({
    queryKey: ['water-period-summary', selectedPeriodId],
    queryFn: () => waterApi.getPeriodSummary(selectedPeriodId).then((r: any) => r.data ?? r),
    enabled: !!selectedPeriodId,
  });

  /* Load flats into readings table when flats or period changes */
  useEffect(() => {
    const flats: any[] = Array.isArray(flatsData)
      ? flatsData
      : (flatsData?.data ?? []);

    if (!flats.length) return;

    // If we have existing readings, pre-populate them
    const existingMap = new Map<string, any>(
      (existingReadings?.readings ?? []).map((r: any) => [r.flatId, r]),
    );

    setReadings(
      flats.map((f) => {
        const ex = existingMap.get(f.id);
        return {
          flatId: f.id,
          flatCode: f.flatCode,
          openingReading: ex ? String(ex.openingReading) : '',
          closingReading: ex ? String(ex.closingReading) : '',
          notes: ex?.notes ?? '',
        };
      }),
    );

    // Pre-fill costs if existing summary has data
    if (existingReadings?.readingCount > 0) {
      setResult(null); // clear preview so user re-calculates
    }
  }, [flatsData, selectedPeriodId, existingReadings]);

  const setReading = (flatId: string, key: keyof FlatReading, value: string) => {
    setReadings((prev) =>
      prev.map((r) => (r.flatId === flatId ? { ...r, [key]: value } : r)),
    );
    setResult(null); // clear preview on edit
  };

  /* Allocation mutation */
  const allocateMutation = useMutation({
    mutationFn: () => {
      const validReadings = readings.filter(
        (r) => r.openingReading !== '' && r.closingReading !== '',
      );
      if (!validReadings.length) throw new Error('Enter readings for at least one flat');
      if (!selectedPeriodId) throw new Error('Select a billing period');

      return waterApi.allocatePeriodCosts(selectedPeriodId, {
        readingDate: new Date().toISOString().slice(0, 10),
        municipalWaterBill: parseFloat(costs.municipalWaterBill) || 0,
        tankerCost: parseFloat(costs.tankerCost) || 0,
        commonElectricityBill: parseFloat(costs.commonElectricityBill) || 0,
        electricityWaterPercent: parseFloat(costs.electricityWaterPercent) || 0,
        readings: validReadings.map((r) => ({
          flatId: r.flatId,
          openingReading: parseFloat(r.openingReading),
          closingReading: parseFloat(r.closingReading),
          notes: r.notes || undefined,
        })),
      }).then((res: any) => res.data ?? res);
    },
    onSuccess: (data: AllocationResult) => {
      setResult(data);
      setActiveTab('summary');
      refetchSummary();
      toast.success(`Water charges calculated & saved! Rate: ${formatCurrency(data.ratePerUnit)}/KL`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? e.message ?? 'Failed to calculate'),
  });

  const periods: any[] = Array.isArray(periodsData)
    ? periodsData
    : (periodsData?.data ?? []);
  const flats: any[] = Array.isArray(flatsData) ? flatsData : (flatsData?.data ?? []);

  const totalWaterCost =
    (parseFloat(costs.municipalWaterBill) || 0) +
    (parseFloat(costs.tankerCost) || 0) +
    ((parseFloat(costs.electricityWaterPercent) || 0) / 100) *
      (parseFloat(costs.commonElectricityBill) || 0);

  const totalUnitsEntered = readings.reduce((s, r) => {
    const o = parseFloat(r.openingReading) || 0;
    const c = parseFloat(r.closingReading) || 0;
    return s + Math.max(0, c - o);
  }, 0);

  const previewRate = totalUnitsEntered > 0 ? totalWaterCost / totalUnitsEntered : 0;

  if (loadingPeriods || loadingFlats) return <PageSpinner />;

  if (!isAdmin) {
    return (
      <>
        <Header title="Water Billing" subtitle="Water meter readings & charges" />
        <PageContainer>
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            <Droplets size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm">Only society admins and accountants can manage water billing.</p>
          </div>
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <Header
        title="Water Billing"
        subtitle="Record monthly meter readings & calculate charges"
        actions={
          <Button
            onClick={() => allocateMutation.mutate()}
            loading={allocateMutation.isPending}
            disabled={!selectedPeriodId || !readings.some((r) => r.closingReading)}
          >
            <Calculator size={14} className="mr-1.5" />
            Calculate & Save
          </Button>
        }
      />

      <PageContainer className="space-y-6">
        {/* Period selector */}
        <div className="flex items-center gap-4">
          <div className="flex-1 max-w-xs">
            <label className="mb-1 block text-sm font-medium text-slate-700">Billing Period</label>
            <div className="relative">
              <select
                value={selectedPeriodId}
                onChange={(e) => {
                  setSelectedPeriodId(e.target.value);
                  setResult(null);
                }}
                className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 pr-8"
              >
                <option value="">Select period…</option>
                {periods.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {billingPeriodLabel(p)}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
          {selectedPeriodId && existingReadings?.readingCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
              <CheckCircle2 size={13} />
              {existingReadings.readingCount} readings saved · Rate: {formatCurrency(existingReadings.ratePerUnit)}/KL
            </div>
          )}
        </div>

        {/* Cost breakdown */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Info size={14} className="text-slate-400" />
            Monthly Water Cost Components
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CostCard
              icon={Building2}
              label="Municipal Water Bill"
              hint="Monthly BWSSB / municipal water board bill"
              iconColor="bg-blue-500"
              value={costs.municipalWaterBill}
              onChange={(v) => { setCosts((c) => ({ ...c, municipalWaterBill: v })); setResult(null); }}
            />
            <CostCard
              icon={Truck}
              label="Tanker Cost"
              hint="Total amount paid for water tankers this month"
              iconColor="bg-orange-500"
              value={costs.tankerCost}
              onChange={(v) => { setCosts((c) => ({ ...c, tankerCost: v })); setResult(null); }}
            />
            <CostCard
              icon={Zap}
              label="Common Electricity Bill"
              hint="Total common electricity bill (motor, lights, lifts…)"
              iconColor="bg-yellow-500"
              value={costs.commonElectricityBill}
              onChange={(v) => { setCosts((c) => ({ ...c, commonElectricityBill: v })); setResult(null); }}
            />
            <CostCard
              icon={Droplets}
              label="Water Motor %"
              hint="What % of the electricity bill is for water motor/pump"
              iconColor="bg-teal-500"
              value={costs.electricityWaterPercent}
              onChange={(v) => { setCosts((c) => ({ ...c, electricityWaterPercent: v })); setResult(null); }}
              suffix="%"
            />
          </div>

          {/* Live cost preview */}
          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap gap-6 text-sm">
            <span className="text-slate-600">
              Electricity for water: <strong>{formatCurrency((parseFloat(costs.electricityWaterPercent) || 0) / 100 * (parseFloat(costs.commonElectricityBill) || 0))}</strong>
            </span>
            <span className="text-slate-600">
              Total water cost: <strong className="text-primary-700">{formatCurrency(totalWaterCost)}</strong>
            </span>
            {totalUnitsEntered > 0 && (
              <span className="text-slate-600">
                Preview rate: <strong className="text-primary-700">{formatCurrency(previewRate)}/KL</strong>
                {' '}({totalUnitsEntered.toFixed(2)} KL total)
              </span>
            )}
          </div>
        </div>

        {/* Tabs: Entry | Summary */}
        <div>
          <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
            {(['entry', 'summary'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  activeTab === t ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {t === 'entry' ? 'Meter Readings' : 'Preview / Result'}
              </button>
            ))}
          </div>

          {/* Meter readings entry */}
          {activeTab === 'entry' && (
            <Card padding="none">
              {!selectedPeriodId ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  Select a billing period to enter readings
                </div>
              ) : flats.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  No active flats found. Add flats in the Flats section first.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Flat</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Opening (KL)</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closing (KL)</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Consumed (KL)</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Est. Charge</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {readings.map((r) => {
                        const o = parseFloat(r.openingReading) || 0;
                        const c = parseFloat(r.closingReading) || 0;
                        const consumed = Math.max(0, c - o);
                        const estCharge = consumed * previewRate;
                        const hasError = c < o && r.closingReading !== '';
                        return (
                          <tr key={r.flatId} className={cn('hover:bg-slate-50', hasError && 'bg-red-50')}>
                            <td className="px-4 py-2.5 font-semibold text-slate-900">{r.flatCode}</td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={r.openingReading}
                                onChange={(e) => setReading(r.flatId, 'openingReading', e.target.value)}
                                placeholder="0.000"
                                className="w-28 rounded border border-slate-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={r.closingReading}
                                onChange={(e) => setReading(r.flatId, 'closingReading', e.target.value)}
                                placeholder="0.000"
                                className={cn(
                                  'w-28 rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1',
                                  hasError
                                    ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                                    : 'border-slate-300 focus:border-primary-500 focus:ring-primary-500',
                                )}
                              />
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-slate-700">
                              {r.openingReading && r.closingReading ? (
                                <span className={consumed === 0 ? 'text-slate-400' : ''}>
                                  {consumed.toFixed(3)}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">
                              {r.openingReading && r.closingReading && previewRate > 0 ? (
                                <span className="font-medium text-primary-700">{formatCurrency(estCharge)}</span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="text"
                                value={r.notes}
                                onChange={(e) => setReading(r.flatId, 'notes', e.target.value)}
                                placeholder="Optional note"
                                className="w-32 rounded border border-slate-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                        <td className="px-4 py-3 text-slate-700">Total</td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 tabular-nums text-slate-800">{totalUnitsEntered.toFixed(3)} KL</td>
                        <td className="px-4 py-3 tabular-nums text-primary-700">{formatCurrency(totalWaterCost)}</td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Preview / Result */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {!result && !existingReadings?.readingCount ? (
                <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
                  Enter readings and click &ldquo;Calculate & Save&rdquo; to see results.
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {[
                      { label: 'Total Water Cost', value: formatCurrency(result?.costBreakdown.totalWaterCost ?? existingReadings?.totalCharge ?? 0) },
                      { label: 'Total Units', value: `${(result?.totalUnits ?? existingReadings?.totalUnits ?? 0).toFixed(2)} KL` },
                      { label: 'Rate per KL', value: formatCurrency(result?.ratePerUnit ?? existingReadings?.ratePerUnit ?? 0) },
                      { label: 'Flats Covered', value: String(result?.flatCount ?? existingReadings?.readingCount ?? 0) },
                    ].map(({ label, value }) => (
                      <Card key={label} padding="lg">
                        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
                      </Card>
                    ))}
                  </div>

                  {/* Flat-wise breakdown */}
                  <Card padding="none">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-sm font-semibold text-slate-900">Flat-wise Water Charges</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        These amounts will be added to each flat&apos;s maintenance bill when you generate bills for the period.
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50">
                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Flat</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Opening</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Closing</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Consumed (KL)</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Water Charge</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(result?.flatReadings ?? existingReadings?.readings ?? []).map((r: any) => (
                            <tr key={r.flatId} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5 font-semibold text-slate-900">{r.flatCode}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.openingReading?.toFixed(3)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{r.closingReading?.toFixed(3)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{(r.consumption ?? (r.closingReading - r.openingReading)).toFixed(3)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary-700">
                                {formatCurrency(r.charge ?? r.calculatedAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <strong>Next step:</strong> Go to Billing → select this period → click &ldquo;Generate Bills&rdquo; to include these water charges in each flat&apos;s maintenance bill.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    </>
  );
}
