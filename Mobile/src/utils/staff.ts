/**
 * Staff gate logic that does not need a screen, kept pure so every rule (which button a guard sees,
 * what a person's status reads as) is testable. The server enforces all of it again; this only
 * decides what to offer.
 */

import type { GateStaff } from '@/api/endpoints/staff.api';
import { fmtTime } from '@/utils/amenity-time';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

/** The one badge that matters most about a person right now. */
export function staffBadge(s: Pick<GateStaff, 'inside' | 'status' | 'checkInAt' | 'checkOutAt' | 'dayOff'>): { label: string; variant: Variant } {
  if (s.inside) return { label: 'Inside', variant: 'success' };
  if (s.checkOutAt) return { label: 'Left', variant: 'neutral' };
  if (s.status === 'ABSENT') return { label: 'Absent', variant: 'error' };
  if (s.status === 'LEAVE') return { label: 'On leave', variant: 'info' };
  if (s.dayOff) return { label: 'Day off', variant: 'neutral' };
  return { label: 'Not in yet', variant: 'warning' };
}

/** A person can be checked in once a day: only when no check-in is recorded. */
export const canCheckIn = (s: Pick<GateStaff, 'checkInAt' | 'inside'>): boolean => !s.checkInAt && !s.inside;
export const canCheckOut = (s: Pick<GateStaff, 'inside'>): boolean => s.inside;

/** "Morning 06:00–14:00 · Main gate", or what is known; null when nothing is planned. */
export function dutyLine(s: Pick<GateStaff, 'shiftName' | 'shiftStart' | 'shiftEnd' | 'post' | 'dayOff'>): string | null {
  if (s.shiftName) {
    const when = s.shiftStart && s.shiftEnd ? ` ${s.shiftStart}–${s.shiftEnd}` : '';
    return `${s.shiftName}${when}${s.post ? ` · ${s.post}` : ''}`;
  }
  return s.dayOff ? 'Day off today' : null;
}

/** "In 6:05 AM · Out 2:10 PM", from whatever has happened so far. */
export function timesLine(s: Pick<GateStaff, 'checkInAt' | 'checkOutAt'>): string | null {
  const parts: string[] = [];
  if (s.checkInAt) parts.push(`In ${fmtTime(s.checkInAt)}`);
  if (s.checkOutAt) parts.push(`Out ${fmtTime(s.checkOutAt)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "3 inside · 2 still to come", counting only people on duty today. */
export function dutySummary(staff: Pick<GateStaff, 'inside' | 'shiftName' | 'checkInAt'>[]): string {
  const inside = staff.filter((s) => s.inside).length;
  const toCome = staff.filter((s) => s.shiftName && !s.checkInAt).length;
  return `${inside} inside${toCome ? ` · ${toCome} still to come` : ''}`;
}
