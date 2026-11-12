import { audienceLabel, audienceProblem, cleanAudienceConfig, MAX_AUDIENCE_IDS, needsBuildings, needsFlats } from './audience';

describe('notification audience', () => {
  describe('cleanAudienceConfig', () => {
    it('keeps the two known lists and drops anything else', () => {
      expect(cleanAudienceConfig({ buildingIds: ['b1'], flatIds: ['f1'], other: 'x' })).toEqual({ buildingIds: ['b1'], flatIds: ['f1'] });
    });
    it('removes repeats, blanks and non-text, and trims', () => {
      expect(cleanAudienceConfig({ buildingIds: ['b1', ' b1 ', '', '   ', 7, null, 'b2'] })).toEqual({ buildingIds: ['b1', 'b2'] });
    });
    it('is empty for anything that is not an object', () => {
      for (const raw of [undefined, null, 'x', 5, ['b1'], true]) expect(cleanAudienceConfig(raw)).toEqual({});
    });
    it('ignores a list that is not a list', () => {
      expect(cleanAudienceConfig({ buildingIds: 'b1', flatIds: { 0: 'f1' } })).toEqual({});
    });
    it('caps a runaway list', () => {
      const many = Array.from({ length: MAX_AUDIENCE_IDS + 50 }, (_v, i) => `f${i}`);
      expect(cleanAudienceConfig({ flatIds: many }).flatIds).toHaveLength(MAX_AUDIENCE_IDS);
    });
  });

  describe('audienceProblem', () => {
    it('needs a building for BUILDING and BLOCK, and a flat for SPECIFIC_FLATS', () => {
      expect(audienceProblem('BUILDING', {})).toMatch(/building/i);
      expect(audienceProblem('BLOCK', { buildingIds: [] })).toMatch(/building/i);
      expect(audienceProblem('SPECIFIC_FLATS', { buildingIds: ['b1'] })).toMatch(/flat/i);
      expect(audienceProblem('BUILDING', { buildingIds: ['b1'] })).toBeNull();
      expect(audienceProblem('BLOCK', { buildingIds: ['b1'] })).toBeNull();
      expect(audienceProblem('SPECIFIC_FLATS', { flatIds: ['f1'] })).toBeNull();
    });
    it('asks for nothing for everyone, the committee or the staff', () => {
      for (const a of ['ALL_RESIDENTS', 'ALL', 'COMMITTEE', 'STAFF'] as const) expect(audienceProblem(a, {})).toBeNull();
    });
  });

  it('knows which audiences are chosen by building or by flat', () => {
    expect(needsBuildings('BUILDING')).toBe(true);
    expect(needsBuildings('BLOCK')).toBe(true);
    expect(needsBuildings('SPECIFIC_FLATS')).toBe(false);
    expect(needsFlats('SPECIFIC_FLATS')).toBe(true);
    expect(needsFlats('BUILDING')).toBe(false);
  });

  describe('audienceLabel', () => {
    it('says who it went to', () => {
      expect(audienceLabel('ALL_RESIDENTS', {})).toBe('everyone');
      expect(audienceLabel('ALL', {})).toBe('everyone');
      expect(audienceLabel('COMMITTEE', {})).toBe('the committee');
      expect(audienceLabel('STAFF', {})).toBe('the staff');
      expect(audienceLabel('BUILDING', { buildingIds: ['a'] })).toBe('1 building');
      expect(audienceLabel('BLOCK', { buildingIds: ['a', 'b'] })).toBe('2 buildings');
      expect(audienceLabel('SPECIFIC_FLATS', { flatIds: ['a', 'b', 'c'] })).toBe('3 flats');
    });
  });
});
