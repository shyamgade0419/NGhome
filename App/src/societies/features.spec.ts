import { FEATURE_KEYS, featurePatchProblem, readFeatures } from './features';

describe('society features', () => {
  it('has every feature on for a society that never set them, however empty its configuration is', () => {
    for (const config of [null, undefined, {}, { features: null }, { features: [] }, { features: 'nope' }, { upiId: 'a@b' }]) {
      const f = readFeatures(config);
      expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort());
      expect(Object.values(f).every((v) => v === true)).toBe(true);
    }
  });

  it('turns a feature off only when it is stored as exactly false', () => {
    const f = readFeatures({ features: { parking: false, visitors: 0, amenities: 'no', events: null, meetings: true } });
    expect(f.parking).toBe(false);
    // Anything that is not the boolean false leaves it on: a malformed value never hides a screen.
    expect([f.visitors, f.amenities, f.events, f.meetings, f.deliveries]).toEqual([true, true, true, true, true]);
  });

  it('ignores names it does not know when reading', () => {
    expect(readFeatures({ features: { unicorn: false } })).not.toHaveProperty('unicorn');
  });

  it('accepts a patch of known names with true or false', () => {
    expect(featurePatchProblem({})).toBeNull();
    expect(featurePatchProblem({ parking: false })).toBeNull();
    expect(featurePatchProblem({ parking: false, amenities: true, householdHelp: false })).toBeNull();
  });

  it('refuses what is not an object, an unknown name, or a value that is not true or false, in plain words', () => {
    for (const bad of [null, 'parking', 42, ['parking']]) expect(featurePatchProblem(bad)).toMatch(/object/);
    expect(featurePatchProblem({ parkng: false })).toMatch(/"parkng" is not a feature.*parking/);
    for (const v of ['false', 0, null, 'yes', {}]) expect(featurePatchProblem({ parking: v })).toMatch(/"parking" must be true or false/);
  });
});
