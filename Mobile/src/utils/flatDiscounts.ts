/** Standing flat discounts and advance credit. See the API's billing/flat-discounts and billing/advance-credits. */

export type DiscountType = 'FIXED' | 'PERCENT';
export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

export interface FlatDiscount {
  id: string;
  flatId: string;
  flatCode: string;
  residentName: string | null;
  type: DiscountType;
  value: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  status: DiscountStatus;
}

export interface AdvanceCredits {
  total: string;
  flats: { flatId: string; flatCode: string; residentName: string | null; balance: string }[];
}

export const STATUS_LABEL: Record<DiscountStatus, { text: string; variant: 'success' | 'info' | 'neutral' | 'warning' }> = {
  ACTIVE: { text: 'In force', variant: 'success' },
  SCHEDULED: { text: 'Starts later', variant: 'info' },
  ENDED: { text: 'Ended', variant: 'neutral' },
  OFF: { text: 'Switched off', variant: 'warning' },
};

/** "₹500 off" or "10% off". */
export function describeDiscount(type: DiscountType, value: string | number): string {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return type === 'PERCENT' ? `${n}% off` : `₹${n.toLocaleString('en-IN')} off`;
}

/** The first day of a month ("2026-04") for the API's date range. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** The last day of a month ("2026-04" → "2026-04-30"). */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** A month typed as "4/2026", "04-2026", "2026-4" or "2026-04", as "2026-04"; null if it is not a month. */
export function parseMonth(raw: string): string | null {
  const t = raw.trim();
  let y: string;
  let m: string;
  let hit = /^(\d{4})[-/](\d{1,2})$/.exec(t);
  if (hit) { y = hit[1]; m = hit[2]; } else {
    hit = /^(\d{1,2})[-/](\d{4})$/.exec(t);
    if (!hit) return null;
    m = hit[1]; y = hit[2];
  }
  const mm = Number(m);
  if (mm < 1 || mm > 12) return null;
  return `${y}-${String(mm).padStart(2, '0')}`;
}
