import { HELPER_ROLES, canLetIn, helperBadge, helperSubtitle, isSuspended, lastSeen, phoneForApi, phoneLooksWrong, roleLabel, shareMessage, visitSpan } from '@/utils/helpers';

describe('how a person is described', () => {
  it('shows the most important thing first: suspended beats inside beats not here', () => {
    expect(helperBadge({ status: 'SUSPENDED', inside: true })).toEqual({ label: 'Suspended', variant: 'error' });
    expect(helperBadge({ status: 'ACTIVE', inside: true })).toEqual({ label: 'Inside now', variant: 'success' });
    expect(helperBadge({ status: 'ACTIVE', inside: false })).toEqual({ label: 'Not here', variant: 'neutral' });
  });

  it('names every role in plain words', () => {
    for (const r of HELPER_ROLES) expect(roleLabel(r.value)).toBe(r.label);
    expect(HELPER_ROLES.map((r) => r.value)).toEqual(['MAID', 'COOK', 'DRIVER', 'NANNY', 'CLEANER', 'GARDENER', 'OTHER']);
  });

  it('says whether the committee confirmed them', () => {
    expect(helperSubtitle({ role: 'MAID', verified: true })).toBe('Maid · Verified by committee');
    expect(helperSubtitle({ role: 'COOK', verified: false })).toBe('Cook');
  });

  it('says when they were last here, or that they have not come', () => {
    expect(lastSeen(null)).toBe('Has not come yet');
    expect(lastSeen('2026-10-30T04:00:00Z')).toContain('Last here');
  });
});

describe('what the guard may do', () => {
  it('lets in only someone who is active and not already inside', () => {
    expect(canLetIn({ status: 'ACTIVE', inside: false })).toBe(true);
    expect(canLetIn({ status: 'ACTIVE', inside: true })).toBe(false);
    expect(canLetIn({ status: 'SUSPENDED', inside: false })).toBe(false);
  });

  it('knows who is suspended', () => {
    expect(isSuspended({ status: 'SUSPENDED' })).toBe(true);
    expect(isSuspended({ status: 'ACTIVE' })).toBe(false);
  });
});

describe('visit spans', () => {
  const base = { checkedInAt: '2026-10-30T04:00:00Z', checkedOutAt: null, autoClosed: false };
  it('says inside while open, shows the exit once recorded', () => {
    expect(visitSpan(base)).toMatch(/– inside$/);
    expect(visitSpan({ ...base, checkedOutAt: '2026-10-30T08:00:00Z' })).not.toContain('inside');
  });

  it('is honest about a visit nobody closed, and never invents an exit', () => {
    const s = visitSpan({ ...base, checkedOutAt: base.checkedInAt, autoClosed: true });
    expect(s).toMatch(/exit not recorded$/);
  });
});

describe('the phone box', () => {
  it.each([
    ['98765 43210', '9876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['(098) 7654 3210', '09876543210'],
  ])('%j is sent as %s', (typed, sent) => expect(phoneForApi(typed)).toBe(sent));

  it.each([['abc'], ['12345'], ['']])('%j is not sent', (typed) => expect(phoneForApi(typed)).toBeUndefined());

  it('flags a typed number that cannot be used, but not an empty box', () => {
    expect(phoneLooksWrong('')).toBe(false);
    expect(phoneLooksWrong('   ')).toBe(false);
    expect(phoneLooksWrong('12345')).toBe(true);
    expect(phoneLooksWrong('9876543210')).toBe(false);
  });
});

describe('sharing the code', () => {
  it('carries the code and where to show it, and nothing about the flat or the resident', () => {
    const m = shareMessage({ name: 'Lakshmi', code: 'K7QX-92MD', societyName: 'Green Park' });
    expect(m).toContain('K7QX-92MD');
    expect(m).toContain('Green Park');
    expect(m).toContain('Lakshmi');
    expect(m).not.toMatch(/flat|\b[A-Z]-\d{3}\b/i);
  });

  it('still reads well with no society name', () => {
    expect(shareMessage({ name: 'Lakshmi', code: 'K7QX-92MD' })).toBe('Hi Lakshmi, your entry code is K7QX-92MD. Show it to the guard at the gate when you arrive.');
  });
});
