import { bulkCodes, fitsSlot, normalizePlate, normalizeSearch, VEHICLE_LIMITS } from './vehicle-rules';

describe('normalizePlate', () => {
  it.each([
    ['TS09AB1234', 'TS09AB1234'],
    ['ts 09 ab-1234', 'TS09AB1234'],
    ['Ts.09.Ab.1234', 'TS09AB1234'],
    ['  KA01 MJ 4455 ', 'KA01MJ4455'],
    ['1234', '1234'],
    ['MH12', 'MH12'],
  ])('%j -> %s (the same vehicle however it is typed)', (input, expected) => expect(normalizePlate(input)).toBe(expected));

  it.each([[''], ['abc'], ['---'], ['1'.repeat(13)], [undefined], [null], [12345]])('%j is not a plate', (input) => expect(normalizePlate(input)).toBeNull());
});

describe('normalizeSearch', () => {
  it('keeps what a guard typed, tidied, even when it is only the last digits', () => {
    expect(normalizeSearch('ab-1234')).toBe('AB1234');
    expect(normalizeSearch(' 12 34 ')).toBe('1234');
    expect(normalizeSearch(undefined)).toBe('');
    expect(normalizeSearch('%_')).toBe('');
  });

  it('cannot carry a wildcard into the query', () => {
    expect(normalizeSearch('%A_B%')).toBe('AB');
  });
});

describe('fitsSlot', () => {
  it.each([
    ['CAR', 'CAR', true],
    ['CAR', 'TWO_WHEELER', false],
    ['CAR', 'ANY', true],
    ['TWO_WHEELER', 'TWO_WHEELER', true],
    ['CYCLE', 'TWO_WHEELER', true],
    ['TWO_WHEELER', 'CAR', false],
    ['CYCLE', 'CAR', false],
    ['OTHER', 'ANY', true],
    ['OTHER', 'CAR', false],
    ['OTHER', 'TWO_WHEELER', false],
  ])('a %s in a %s slot -> %s', (kind, slotFor, expected) => expect(fitsSlot(kind as any, slotFor as any)).toBe(expected));
});

describe('bulkCodes', () => {
  it('makes prefix + number for each, padded', () => {
    expect(bulkCodes('B1-', 1, 3, 2)).toEqual(['B1-01', 'B1-02', 'B1-03']);
    expect(bulkCodes('', 8, 10, 0)).toEqual(['8', '9', '10']);
    expect(bulkCodes('P', 5, 5, 3)).toEqual(['P005']);
  });

  it('refuses a backwards range, a non-whole number, and more than the limit', () => {
    expect(bulkCodes('A', 5, 4, 0)).toBeNull();
    expect(bulkCodes('A', 1.5, 3, 0)).toBeNull();
    expect(bulkCodes('A', 1, VEHICLE_LIMITS.bulkSlots + 1, 0)).toBeNull();
    expect(bulkCodes('A', 1, VEHICLE_LIMITS.bulkSlots, 0)).toHaveLength(VEHICLE_LIMITS.bulkSlots);
  });
});
