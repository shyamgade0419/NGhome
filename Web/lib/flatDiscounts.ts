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

export interface FlatDiscountInput {
  flatId: string;
  type: DiscountType;
  value: number;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface AdvanceCredits {
  total: string;
  flats: { flatId: string; flatCode: string; residentName: string | null; balance: string }[];
}

export const STATUS_LABEL: Record<DiscountStatus, { text: string; variant: 'success' | 'info' | 'muted' | 'warning' }> = {
  ACTIVE: { text: 'In force', variant: 'success' },
  SCHEDULED: { text: 'Starts later', variant: 'info' },
  ENDED: { text: 'Ended', variant: 'muted' },
  OFF: { text: 'Switched off', variant: 'warning' },
};

/** "₹500 off" or "10% off". */
export function describeDiscount(type: DiscountType, value: string | number): string {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return type === 'PERCENT' ? `${n}% off` : `₹${n.toLocaleString('en-IN')} off`;
}

/** The first day of a month input ("2026-04") as a date, and its last day, for the API's date range. */
export function monthStart(month: string): string {
  return `${month}-01`;
}
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}
