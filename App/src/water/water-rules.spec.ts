import { readingOrderMessage, waterConsumption } from './water-rules';

describe('water consumption', () => {
  it('counts up on an ordinary meter', () => {
    expect(waterConsumption(100, 126, false)).toBe(26);
    expect(waterConsumption(100, 100, false)).toBe(0);
  });

  it('counts down on a reversed meter — 98362 then 98336 is 26 used', () => {
    expect(waterConsumption(98362, 98336, true)).toBe(26);
    expect(waterConsumption(500, 500, true)).toBe(0);
  });

  it('refuses a reading on the wrong side for the meter, either way round', () => {
    expect(waterConsumption(98362, 98336, false)).toBeNull();
    expect(waterConsumption(98336, 98362, true)).toBeNull();
  });

  it('keeps decimals exact enough for a KL meter', () => {
    expect(waterConsumption(10.25, 12.75, false)).toBeCloseTo(2.5);
    expect(waterConsumption(12.75, 10.25, true)).toBeCloseTo(2.5);
  });

  it('says which way the meter runs, and points an ordinary flat at the setting', () => {
    expect(readingOrderMessage(true)).toMatch(/counts down/);
    expect(readingOrderMessage(false)).toMatch(/mark it that way/);
    expect(readingOrderMessage(true, 'Flat A-1')).toMatch(/^Flat A-1: /);
  });
});
