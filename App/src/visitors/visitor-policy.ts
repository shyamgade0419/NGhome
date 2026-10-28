/**
 * A society's visitor rules. Stored in SocietyConfiguration.additionalConfig
 * (key "visitorPolicy"), so it needs no migration, and always read through
 * readPolicy so a missing, partial or hand-edited value falls back to a safe
 * default rather than breaking the gate.
 */

export type WalkInApproval = 'REQUIRED' | 'NOT_REQUIRED';

export interface VisitorPolicy {
  /** REQUIRED: a resident must approve every visitor who arrives without an invitation. */
  walkInApproval: WalkInApproval;
  /** The longest an invitation may stay valid, in days. */
  maxInviteDays: number;
  /** The most entries one invitation may admit. */
  maxUsesPerInvite: number;
  /** How long a resident has to answer before the request lapses. */
  approvalWindowMinutes: number;
}

export const DEFAULT_POLICY: VisitorPolicy = {
  walkInApproval: 'REQUIRED',
  maxInviteDays: 7,
  maxUsesPerInvite: 10,
  approvalWindowMinutes: 30,
};

export const POLICY_LIMITS = {
  maxInviteDays: { min: 1, max: 30 },
  maxUsesPerInvite: { min: 1, max: 50 },
  approvalWindowMinutes: { min: 5, max: 240 },
} as const;

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function readPolicy(additionalConfig: unknown): VisitorPolicy {
  const raw = (additionalConfig as { visitorPolicy?: Partial<VisitorPolicy> } | null | undefined)?.visitorPolicy;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POLICY };
  const l = POLICY_LIMITS;
  return {
    walkInApproval: raw.walkInApproval === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'REQUIRED',
    maxInviteDays: inRange(raw.maxInviteDays, l.maxInviteDays.min, l.maxInviteDays.max) ? raw.maxInviteDays : DEFAULT_POLICY.maxInviteDays,
    maxUsesPerInvite: inRange(raw.maxUsesPerInvite, l.maxUsesPerInvite.min, l.maxUsesPerInvite.max)
      ? raw.maxUsesPerInvite
      : DEFAULT_POLICY.maxUsesPerInvite,
    approvalWindowMinutes: inRange(raw.approvalWindowMinutes, l.approvalWindowMinutes.min, l.approvalWindowMinutes.max)
      ? raw.approvalWindowMinutes
      : DEFAULT_POLICY.approvalWindowMinutes,
  };
}
