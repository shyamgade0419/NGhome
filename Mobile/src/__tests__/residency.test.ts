import { joiningAs, normalizeResidency, otherResidency, residencyChangePrompt } from '@/utils/residency';

describe('owner or tenant', () => {
  it('treats anything but TENANT as owner, so older data is never mistaken for a tenant', () => {
    expect(normalizeResidency('TENANT')).toBe('TENANT');
    expect(normalizeResidency('OWNER')).toBe('OWNER');
    expect(normalizeResidency(undefined)).toBe('OWNER');
    expect(normalizeResidency(null)).toBe('OWNER');
    expect(normalizeResidency('landlord')).toBe('OWNER');
  });

  it('flips between the two', () => {
    expect(otherResidency('OWNER')).toBe('TENANT');
    expect(otherResidency('TENANT')).toBe('OWNER');
  });

  it('says what changes for the person before the admin confirms', () => {
    const t = residencyChangePrompt('Deepa Iyer', 'TENANT');
    expect(t.title).toBe('Mark Deepa Iyer as a tenant?');
    expect(t.message).toMatch(/not the corpus fund or the bank balances/);
    expect(t.confirm).toBe('Mark as tenant');
    const o = residencyChangePrompt('Deepa Iyer', 'OWNER');
    expect(o.message).toMatch(/corpus fund and the bank balances/);
    expect(o.confirm).toBe('Mark as owner');
  });

  it('words a join request', () => {
    expect(joiningAs('TENANT')).toBe('a tenant');
    expect(joiningAs('OWNER')).toBe('an owner');
    expect(joiningAs(undefined)).toBe('an owner');
  });
});
