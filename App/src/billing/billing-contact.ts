/**
 * Who a flat's bill, and a reminder about it, goes to.
 *
 * The person living in the flat pays the maintenance, so a tenant comes before an owner; with no tenant it is the
 * owner. Within either group the flat's primary resident comes first, then whoever joined earliest, so the same
 * person is picked every time rather than whichever row the database happened to return first.
 */
export interface ContactCandidate {
  residencyType: 'OWNER' | 'TENANT';
  isPrimary: boolean;
  joinedAt: Date;
  user: { firstName: string; lastName: string; phone: string | null };
}

export function pickBillContact<T extends ContactCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  const rank = (c: T) => (c.residencyType === 'TENANT' ? 0 : 1);
  return [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.joinedAt.getTime() - b.joinedAt.getTime(),
  )[0];
}

/** What the admin sees about the person a reminder goes to. */
export function describeContact(c: ContactCandidate | null) {
  if (!c) return { residentName: null, residentPhone: null, residentType: null };
  return {
    residentName: `${c.user.firstName} ${c.user.lastName}`.trim(),
    residentPhone: c.user.phone ?? null,
    residentType: c.residencyType,
  };
}
