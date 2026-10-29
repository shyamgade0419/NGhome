/**
 * Visitor and gate types and labels for the committee's web page. The server
 * owns every rule; this only describes what it returns.
 */

export type VisitorType = 'GUEST' | 'CAB' | 'DELIVERY' | 'SERVICE' | 'OTHER';
export type VisitorEntryStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'EXPIRED';
export type DecisionMethod = 'RESIDENT' | 'POLICY' | 'INVITATION' | 'ADMIN_OVERRIDE' | 'EXPECTATION';

export interface VisitorLogEntry {
  id: string;
  flatId: string;
  flatCode: string | null;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: VisitorType;
  vehicleNumber: string | null;
  purpose: string | null;
  status: VisitorEntryStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decisionMethod: DecisionMethod | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  registeredBy: string | null;
  decidedBy: string | null;
  checkedInBy: string | null;
  checkedOutBy: string | null;
}

export interface VisitorPolicy {
  walkInApproval: 'REQUIRED' | 'NOT_REQUIRED';
  maxInviteDays: number;
  maxUsesPerInvite: number;
  approvalWindowMinutes: number;
}

export const POLICY_LIMITS = {
  maxInviteDays: { min: 1, max: 30 },
  maxUsesPerInvite: { min: 1, max: 50 },
  approvalWindowMinutes: { min: 5, max: 240 },
} as const;

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const ENTRY_STATUS: Record<VisitorEntryStatus, { label: string; variant: BadgeVariant }> = {
  PENDING_APPROVAL: { label: 'Waiting for resident', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'info' },
  REJECTED: { label: 'Declined', variant: 'danger' },
  CHECKED_IN: { label: 'Inside', variant: 'success' },
  CHECKED_OUT: { label: 'Left', variant: 'muted' },
  EXPIRED: { label: 'No answer', variant: 'muted' },
};

export const STATUS_OPTIONS: { value: '' | VisitorEntryStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...(Object.keys(ENTRY_STATUS) as VisitorEntryStatus[]).map((v) => ({ value: v, label: ENTRY_STATUS[v].label })),
];

export const TYPE_OPTIONS: { value: '' | VisitorType; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'GUEST', label: 'Guest' },
  { value: 'CAB', label: 'Cab' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'OTHER', label: 'Other' },
];

export const typeLabel = (t: VisitorType): string => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? 'Visitor';

/** Only a request nobody answered, or one that lapsed, can be decided by the committee. */
export const canOverride = (s: VisitorEntryStatus): boolean => s === 'PENDING_APPROVAL' || s === 'EXPIRED';

export const METHOD_LABEL: Record<DecisionMethod, string> = {
  RESIDENT: 'Resident',
  POLICY: 'Society rule (no approval needed)',
  INVITATION: 'Invitation code',
  ADMIN_OVERRIDE: 'Committee override',
  EXPECTATION: 'Delivery the resident expected',
};
