/**
 * Household-help logic that does not need a screen, kept pure so every rule (which
 * button a guard sees, how a helper is described, what is shared) is testable. The
 * server enforces all of it again; this only decides what to offer.
 */

import type { GateHelper, HelperRole, HelperStatus, HelperVisit, MyHelper } from '@/api/endpoints/helpers.api';
import { fmtDayOf, fmtTime } from '@/utils/amenity-time';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

export const HELPER_ROLES: { value: HelperRole; label: string }[] = [
  { value: 'MAID', label: 'Maid' },
  { value: 'COOK', label: 'Cook' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'NANNY', label: 'Nanny' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'GARDENER', label: 'Gardener' },
  { value: 'OTHER', label: 'Other' },
];

export const roleLabel = (r: HelperRole): string => HELPER_ROLES.find((x) => x.value === r)?.label ?? 'Helper';

/** The one badge that matters most about a person right now. */
export function helperBadge(h: { status: HelperStatus; inside: boolean }): { label: string; variant: Variant } {
  if (h.status === 'SUSPENDED') return { label: 'Suspended', variant: 'error' };
  if (h.inside) return { label: 'Inside now', variant: 'success' };
  return { label: 'Not here', variant: 'neutral' };
}

/** The guard may let in anyone who is not suspended and not already inside. */
export const canLetIn = (h: Pick<GateHelper, 'status' | 'inside'>): boolean => h.status === 'ACTIVE' && !h.inside;
export const isSuspended = (h: Pick<GateHelper, 'status'>): boolean => h.status === 'SUSPENDED';

/** "Maid · Verified", or "Cook" when nobody confirmed them. */
export const helperSubtitle = (h: Pick<MyHelper, 'role' | 'verified'>): string => [roleLabel(h.role), h.verified ? 'Verified by committee' : null].filter(Boolean).join(' · ');

/** "Last here Today, 9:10 AM", or that they have not come yet. */
export const lastSeen = (iso: string | null): string => (iso ? `Last here ${fmtDayOf(iso)}, ${fmtTime(iso)}` : 'Has not come yet');

/** "Today, 9:10 AM – 1:05 PM", "… – inside", or "… – exit not recorded" for a visit nobody closed. */
export function visitSpan(v: Pick<HelperVisit, 'checkedInAt' | 'checkedOutAt' | 'autoClosed'>): string {
  const start = `${fmtDayOf(v.checkedInAt)}, ${fmtTime(v.checkedInAt)}`;
  if (v.autoClosed) return `${start} – exit not recorded`;
  return v.checkedOutAt ? `${start} – ${fmtTime(v.checkedOutAt)}` : `${start} – inside`;
}

/** The phone typed by a resident, kept only if it can be a number (the server normalises it). */
export function phoneForApi(text: string): string | undefined {
  const t = text.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(t) ? t : undefined;
}

/** True when something was typed in the phone box that is not a usable number (so the form can say so instead of dropping it). */
export const phoneLooksWrong = (text: string): boolean => text.trim() !== '' && !phoneForApi(text);

/** What a resident sends the person themselves: the code and where to show it, nothing else. */
export function shareMessage(args: { name: string; code: string; societyName?: string | null }): string {
  const where = args.societyName ? ` at ${args.societyName}` : '';
  return `Hi ${args.name}, your entry code${where} is ${args.code}. Show it to the guard at the gate when you arrive.`;
}
