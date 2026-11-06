/**
 * The parts of NG Home a society can switch off because it does not use them: a standalone apartment block with no
 * parking, no gate or no clubhouse has no use for those screens, and they only clutter the app.
 *
 * Stored in the society's additionalConfig (`features`), so no migration is needed. Every feature is ON unless the society's
 * admin switched it off: a society that never touched the setting, and every new one, sees everything, as before. This is
 * about what the apps show; it does not delete anything, and switching a feature back on brings its data back.
 */
export const FEATURE_KEYS = [
  'visitors',
  'deliveries',
  'householdHelp',
  'parking',
  'amenities',
  'events',
  'meetings',
  'forum',
  'chat',
  'staff',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** What is stored, tolerating a missing or malformed value. A feature is on unless it is stored as exactly `false`. */
export function readFeatures(additionalConfig: unknown): Features {
  const raw = (additionalConfig as { features?: Record<string, unknown> } | null | undefined)?.features;
  const out = {} as Features;
  for (const key of FEATURE_KEYS) out[key] = raw?.[key] !== false;
  return out;
}

/**
 * A change to the features, checked: only known names, only true or false. Returns null when the input is fine, or the
 * reason it is not, in words for the admin. Unknown names are refused rather than ignored, so a typo does not look saved.
 */
export function featurePatchProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'features must be an object such as { "parking": false }.';
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) return `"${key}" is not a feature. Use one of: ${FEATURE_KEYS.join(', ')}.`;
    if (typeof value !== 'boolean') return `"${key}" must be true or false.`;
  }
  return null;
}
