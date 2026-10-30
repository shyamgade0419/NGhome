/**
 * Owner or tenant — wording only. The rule itself (a tenant is not sent the corpus fund or the bank
 * balances) is enforced by the server; the screens just say what has happened.
 */

export type ResidencyType = 'OWNER' | 'TENANT';

export const RESIDENCY_LABEL: Record<ResidencyType, string> = { OWNER: 'Owner', TENANT: 'Tenant' };

export const normalizeResidency = (v: unknown): ResidencyType => (v === 'TENANT' ? 'TENANT' : 'OWNER');

/** What the other choice is, for a toggle. */
export const otherResidency = (v: ResidencyType): ResidencyType => (v === 'TENANT' ? 'OWNER' : 'TENANT');

/** The question to ask the admin before changing someone, saying what changes for them. */
export function residencyChangePrompt(name: string, to: ResidencyType): { title: string; message: string; confirm: string } {
  return to === 'TENANT'
    ? {
        title: `Mark ${name} as a tenant?`,
        message: 'A tenant still sees their bills, maintenance and the society\'s expenses, but not the corpus fund or the bank balances.',
        confirm: 'Mark as tenant',
      }
    : {
        title: `Mark ${name} as an owner?`,
        message: 'An owner can see the corpus fund and the bank balances, if the society has chosen to show them to residents.',
        confirm: 'Mark as owner',
      };
}

/** "as an owner" / "as a tenant" for the join request line. */
export const joiningAs = (v: unknown) => (normalizeResidency(v) === 'TENANT' ? 'a tenant' : 'an owner');
