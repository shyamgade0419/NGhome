/**
 * Household-help types and labels for the committee's web page. The server owns every
 * rule; this only describes what it returns.
 */

export type HelperRole = 'MAID' | 'COOK' | 'DRIVER' | 'NANNY' | 'CLEANER' | 'GARDENER' | 'OTHER';
export type HelperStatus = 'ACTIVE' | 'SUSPENDED';

export interface HelperRow {
  id: string;
  name: string;
  phone: string | null;
  role: HelperRole;
  status: HelperStatus;
  verified: boolean;
  suspendedReason: string | null;
  flatCodes: string[];
  inside: boolean;
  lastVisitAt: string | null;
  createdAt: string;
}

export interface HelperVisitRow {
  id: string;
  helperId: string;
  name: string;
  role: HelperRole;
  flatCodes: string[];
  checkedInAt: string;
  checkedOutAt: string | null;
  method: 'CODE' | 'GUARD';
  autoClosed: boolean;
  checkedInBy: string | null;
  checkedOutBy: string | null;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const ROLE_LABEL: Record<HelperRole, string> = {
  MAID: 'Maid', COOK: 'Cook', DRIVER: 'Driver', NANNY: 'Nanny', CLEANER: 'Cleaner', GARDENER: 'Gardener', OTHER: 'Other',
};

export const STATUS_OPTIONS: { value: '' | HelperStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

/** The one badge that matters most about a person right now. */
export function helperBadge(h: Pick<HelperRow, 'status' | 'inside'>): { label: string; variant: BadgeVariant } {
  if (h.status === 'SUSPENDED') return { label: 'Suspended', variant: 'danger' };
  if (h.inside) return { label: 'Inside now', variant: 'success' };
  return { label: 'Not here', variant: 'muted' };
}

/** How long a visit lasted, "2 h 15 min"; "—" when it is still open or its exit was never recorded. */
export function duration(v: Pick<HelperVisitRow, 'checkedInAt' | 'checkedOutAt' | 'autoClosed'>): string {
  if (!v.checkedOutAt || v.autoClosed) return '—';
  const mins = Math.max(0, Math.round((new Date(v.checkedOutAt).getTime() - new Date(v.checkedInAt).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${mins % 60} min` : `${mins} min`;
}
