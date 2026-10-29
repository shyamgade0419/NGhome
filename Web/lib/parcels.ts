/**
 * Parcel types and labels for the committee's web page. The server owns every
 * rule; this only describes what it returns.
 */

export type ParcelStatus = 'RECEIVED' | 'COLLECTED' | 'RETURNED';

export interface ParcelLogEntry {
  id: string;
  flatId: string;
  flatCode: string | null;
  courier: string;
  recipientName: string | null;
  note: string | null;
  status: ParcelStatus;
  receivedAt: string;
  closedAt: string | null;
  collectedByName: string | null;
  receivedBy: string | null;
  closedBy: string | null;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const PARCEL_STATUS: Record<ParcelStatus, { label: string; variant: BadgeVariant }> = {
  RECEIVED: { label: 'At the gate', variant: 'warning' },
  COLLECTED: { label: 'Collected', variant: 'success' },
  RETURNED: { label: 'Sent back', variant: 'muted' },
};

export const PARCEL_STATUS_OPTIONS: { value: '' | ParcelStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...(Object.keys(PARCEL_STATUS) as ParcelStatus[]).map((v) => ({ value: v, label: PARCEL_STATUS[v].label })),
];

/** How long a parcel has been at the gate, for the ones still there: "3 days", "5 hours", "just now". */
export function heldFor(receivedAt: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 60_000));
  if (mins < 60) return mins < 2 ? 'just now' : `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** A parcel still at the gate after this long is worth the committee's attention. */
export const STALE_AFTER_HOURS = 72;
export const isStale = (p: Pick<ParcelLogEntry, 'status' | 'receivedAt'>, now: Date = new Date()): boolean =>
  p.status === 'RECEIVED' && now.getTime() - new Date(p.receivedAt).getTime() > STALE_AFTER_HOURS * 3_600_000;
