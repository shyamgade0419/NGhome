import { helperCodeHash, normalizePhone } from './helper-rules';
import { hashCode } from '../visitors/visitor-code';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['+91-98765-43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['  98765 43210 ', '9876543210'],
    ['+14155552671', '14155552671'], // another country: kept as typed, digits only
  ])('%j -> %s (the same person however they are typed)', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each([[''], ['abc'], ['12345'], ['1'.repeat(16)], [undefined], [null], [12345678901]])('%j is not a phone number', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe('helperCodeHash', () => {
  it('is deterministic and hides the code', () => {
    expect(helperCodeHash('K7QX92MD')).toBe(helperCodeHash('K7QX92MD'));
    expect(helperCodeHash('K7QX92MD')).not.toContain('K7QX');
    expect(helperCodeHash('K7QX92MD')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs from a visitor invitation hash of the same code, so neither kind of code opens the other', () => {
    expect(helperCodeHash('K7QX92MD')).not.toBe(hashCode('K7QX92MD'));
  });
});
