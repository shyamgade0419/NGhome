import { readingProblem, waterUnits, wrongWayLabel } from '@/utils/water';

describe('water units', () => {
  it('counts up on an ordinary meter', () => {
    expect(waterUnits(100, 126, false)).toBe(26);
    expect(waterUnits(100, 100, false)).toBe(0);
  });

  it('counts down on a reversed meter — 98362 then 98336 is 26 used', () => {
    expect(waterUnits(98362, 98336, true)).toBe(26);
  });

  it('is null when the reading is the wrong way round for that meter', () => {
    expect(waterUnits(98362, 98336, false)).toBeNull();
    expect(waterUnits(98336, 98362, true)).toBeNull();
  });
});

describe('what the person is told', () => {
  it('names the flat and the previous reading, and says which way the meter runs', () => {
    expect(readingProblem('A-102', '98362', true)).toMatch(/A-102.*counts down.*98362/);
    expect(readingProblem('A-101', '100', false)).toMatch(/A-101.*lower than the previous one \(100\)/);
  });

  it('points an ordinary flat at the setting, in case its meter really does count down', () => {
    expect(readingProblem('A-101', '100', false)).toMatch(/counts down/);
  });

  it('labels the row the right way round', () => {
    expect(wrongWayLabel(false)).toBe('Below previous');
    expect(wrongWayLabel(true)).toBe('Above previous');
  });
});
