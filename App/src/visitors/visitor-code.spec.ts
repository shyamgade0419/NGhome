import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, hashCode, normalizeCode } from './visitor-code';
import { DEFAULT_POLICY, readPolicy } from './visitor-policy';

describe('generateCode', () => {
  it('is 8 characters, every one from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('never uses the look-alike characters 0 O 1 I L', () => {
    const all = Array.from({ length: 300 }, generateCode).join('');
    expect(all).not.toMatch(/[01OIL]/);
  });

  it('does not repeat: 2,000 codes are all different', () => {
    expect(new Set(Array.from({ length: 2000 }, generateCode)).size).toBe(2000);
  });

  it('uses the whole alphabet, not a biased corner of it', () => {
    const seen = new Set(Array.from({ length: 3000 }, generateCode).join(''));
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });
});

describe('normalizeCode', () => {
  it.each([
    ['K7QX92MD', 'K7QX92MD'],
    ['k7qx-92md', 'K7QX92MD'],
    ['  K7QX 92MD ', 'K7QX92MD'],
    ['K7QX-92MD', 'K7QX92MD'],
  ])('reads %j as %j', (input, out) => expect(normalizeCode(input)).toBe(out));

  it.each(['', 'K7QX', 'K7QX92MDX', 'K7QX-92M0', 'K7QX-92MI', 'K7QX92M!', null, undefined, 12345678, {}])(
    'rejects %j without guessing',
    (input) => expect(normalizeCode(input)).toBeNull(),
  );

  it('round-trips with formatCode', () => {
    const c = generateCode();
    expect(formatCode(c)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeCode(formatCode(c))).toBe(c);
  });
});

describe('hashCode', () => {
  it('is deterministic and reveals nothing readable', () => {
    expect(hashCode('K7QX92MD')).toBe(hashCode('K7QX92MD'));
    expect(hashCode('K7QX92MD')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode('K7QX92MD')).not.toContain('K7QX');
  });

  it('differs for different codes', () => {
    expect(hashCode('K7QX92MD')).not.toBe(hashCode('K7QX92ME'));
  });
});

describe('readPolicy', () => {
  it('gives safe defaults when nothing is stored', () => {
    expect(readPolicy(undefined)).toEqual(DEFAULT_POLICY);
    expect(readPolicy({})).toEqual(DEFAULT_POLICY);
    expect(readPolicy({ visitorPolicy: 'nonsense' })).toEqual(DEFAULT_POLICY);
  });

  it('defaults to requiring approval for walk-ins', () => {
    expect(DEFAULT_POLICY.walkInApproval).toBe('REQUIRED');
  });

  it('uses valid stored values', () => {
    expect(readPolicy({ visitorPolicy: { walkInApproval: 'NOT_REQUIRED', maxInviteDays: 3, maxUsesPerInvite: 5, approvalWindowMinutes: 15 } })).toEqual({
      walkInApproval: 'NOT_REQUIRED',
      maxInviteDays: 3,
      maxUsesPerInvite: 5,
      approvalWindowMinutes: 15,
    });
  });

  it('falls back per field for out-of-range or malformed values, and never loosens approval by accident', () => {
    const p = readPolicy({ visitorPolicy: { walkInApproval: 'whatever', maxInviteDays: 9999, maxUsesPerInvite: 0, approvalWindowMinutes: 'soon' } });
    expect(p).toEqual(DEFAULT_POLICY);
  });
});
