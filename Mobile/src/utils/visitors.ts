/**
 * Visitor and gate logic that does not need a screen. Kept pure so every rule
 * — which button a guard sees, how long an invitation can last, what gets
 * shared — is testable. The server enforces all of it again; this only
 * decides what to offer.
 */

import type { InvitationState, VisitorEntry, VisitorEntryStatus, VisitorType } from '@/api/endpoints/visitors.api';
import { fmtDayOf, fmtTime } from '@/utils/amenity-time';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

export const ENTRY_STATUS: Record<VisitorEntryStatus, { label: string; variant: Variant }> = {
  PENDING_APPROVAL: { label: 'Waiting for resident', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'info' },
  REJECTED: { label: 'Declined', variant: 'error' },
  CHECKED_IN: { label: 'Inside', variant: 'success' },
  CHECKED_OUT: { label: 'Left', variant: 'neutral' },
  EXPIRED: { label: 'No answer', variant: 'neutral' },
};

export const INVITATION_STATE: Record<InvitationState, { label: string; variant: Variant }> = {
  ACTIVE: { label: 'Ready to use', variant: 'success' },
  NOT_YET: { label: 'Starts later', variant: 'info' },
  USED: { label: 'Used', variant: 'neutral' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  REVOKED: { label: 'Cancelled', variant: 'error' },
};

export const VISITOR_TYPES: { value: VisitorType; label: string }[] = [
  { value: 'GUEST', label: 'Guest' },
  { value: 'CAB', label: 'Cab' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'OTHER', label: 'Other' },
];

export const visitorTypeLabel = (t: VisitorType): string => VISITOR_TYPES.find((x) => x.value === t)?.label ?? 'Visitor';

/** The guard may let a visitor in only once the resident (or the rules) approved. */
export const canLetIn = (e: Pick<VisitorEntry, 'status'>): boolean => e.status === 'APPROVED';
export const canCheckOut = (e: Pick<VisitorEntry, 'status'>): boolean => e.status === 'CHECKED_IN';
/** A request a resident can still answer. */
export const awaitingResident = (e: Pick<VisitorEntry, 'status'>): boolean => e.status === 'PENDING_APPROVAL';
/** Something the committee may decide on. */
export const canOverride = (e: Pick<VisitorEntry, 'status'>): boolean => e.status === 'PENDING_APPROVAL' || e.status === 'EXPIRED';

/** "Arrived 6:10 PM · Left 7:05 PM", from whatever has happened so far. */
export function timeline(e: Pick<VisitorEntry, 'requestedAt' | 'checkedInAt' | 'checkedOutAt' | 'status'>): string {
  const parts: string[] = [];
  parts.push(`${fmtDayOf(e.requestedAt)}, ${fmtTime(e.requestedAt)}`);
  if (e.checkedInAt) parts.push(`In ${fmtTime(e.checkedInAt)}`);
  if (e.checkedOutAt) parts.push(`Out ${fmtTime(e.checkedOutAt)}`);
  return parts.join(' · ');
}

/** The longest-lasting options a society allows, shortest first. */
export const INVITE_DURATIONS: { label: string; hours: number }[] = [
  { label: '2 hours', hours: 2 },
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
];

/** Offer only the durations the society's policy allows. */
export function allowedDurations(maxInviteDays: number): { label: string; hours: number }[] {
  const options = INVITE_DURATIONS.filter((d) => d.hours <= maxInviteDays * 24);
  return options.length ? options : [INVITE_DURATIONS[0]];
}

export const validUntilFrom = (now: Date, hours: number): string => new Date(now.getTime() + hours * 3_600_000).toISOString();

/**
 * What a resident sends to their guest. It carries the code and when it works
 * — nothing else: no flat number, no resident name, no address.
 */
export function shareMessage(args: { code: string; visitorName: string; societyName?: string | null; validUntil: string }): string {
  const where = args.societyName ? ` for ${args.societyName}` : '';
  return (
    `Hi ${args.visitorName}, your entry code${where} is ${args.code}. ` +
    `It works until ${fmtDayOf(args.validUntil)}, ${fmtTime(args.validUntil)}. Show it to the guard at the gate.`
  );
}

/** A fresh id for one attempt. The server uses it to recognise a retry, so it is made once per attempt, not per tap. */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

/** What a guard types for a code, tidied as they type: upper case, no spaces, at most 8 characters, shown as XXXX-XXXX. */
export function formatCodeInput(text: string): string {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

export const isCompleteCode = (text: string): boolean => text.replace(/[^A-Za-z0-9]/g, '').length === 8;

/** A vehicle number tidied for display and sending. */
export const tidyVehicle = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 20);

export function phoneForApi(text: string): string | undefined {
  const t = text.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(t) ? t : undefined;
}
