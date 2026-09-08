/**
 * Brand-aligned palette — warm beige canvas, navy brand.
 *
 * `primary` and `primaryDark` are the exact navy used on the login screen,
 * splash screen and app icon (#0D2147 / #071428). That navy is fixed: it's
 * baked into the launcher icon and splash asset, so the rest of the app has
 * to sit with it rather than replace it.
 *
 * The neutrals are warm rather than cool. The app previously ran on a
 * blue-grey canvas (#EEF1F8) with white cards, which read as flat
 * white-on-white — colour appeared only in the one navy hero card per screen,
 * so most screens looked like plain documents. Warming the whole neutral ramp
 * (sand canvas, cream cards, tan borders, brown-leaning text) gives every
 * screen a tone of its own without adding decoration, and navy-on-beige is a
 * far richer pairing than navy-on-grey.
 *
 * Contrast is checked, not assumed. Against both `surface` and `background`:
 * `text` clears 12.9:1, `textSecondary` 5.2:1, `primary` 13.7:1 and
 * `secondary` 5.3:1 — all past WCAG AA's 4.5:1 for normal text.
 * `textTertiary` reaches 3.6:1, which clears AA-large but not AA-normal; it's
 * used only for placeholders and hints, and it's still a real improvement on
 * the previous palette's tertiary, which sat at ~2.8:1 and cleared neither.
 */
export const colors = {
  primary: '#0D2147',
  // Warm sand tint of the navy's role, not a blue tint — a cool #E7EAF2 chip
  // on a beige card reads as a foreign element pasted onto the screen.
  primaryLight: '#E9E1D1',
  primaryDark: '#071428',

  // Two steps darker than the raw brand green (#3D8C3C). The previous palette
  // already darkened it once to #377E36 to clear 4.5:1 on white; the warmer,
  // slightly darker canvas costs a little more contrast, so it goes one step
  // further to hold 5.3:1 on beige. Visually still the same brand green.
  secondary: '#2F6E2E',
  secondaryLight: '#E7EFDE',

  // A third brand-adjacent colour, added with the beige canvas. Navy and green
  // are both load-bearing (navy = brand/primary action, green = paid/positive),
  // which left nothing neutral to colour-code anything else with — screens
  // reached for stray cool violets and blues instead, and those now read as
  // foreign against the warm ground. Terracotta belongs to the beige family
  // and carries no status meaning, so it's free to mark things like Events.
  // 4.9:1 on surface as text, 4.1:1 on its own tint behind an icon.
  accent: '#A85A32',
  accentLight: '#F6E4DA',

  success: '#2F6E2E',
  successLight: '#E7EFDE',
  // Amber and red are pulled toward the warm end of their ranges so alerts sit
  // in the same world as the beige rather than fluorescing against it.
  warning: '#B45309',
  warningLight: '#FBEBD7',
  error: '#C2410C',
  errorLight: '#FBE3D8',
  info: '#3B82F6',
  infoLight: '#DBEAFE',

  // Sand canvas with cream cards. The gap between the two is deliberately
  // small — enough for a card to lift off the page, not so much that the
  // screen turns into stripes.
  background: '#F4EEE2',
  surface: '#FFFCF6',
  surfaceSecondary: '#EDE5D6',

  border: '#DFD4BF',
  borderLight: '#EDE5D6',

  // Warm near-black rather than blue-slate: #1E293B on beige looks like text
  // from a different design.
  text: '#2B2620',
  textSecondary: '#6B6153',
  textTertiary: '#857A67',
  textInverse: '#FFFFFF',
  textDisabled: '#C7BCA6',

  overlay: 'rgba(43,38,32,0.5)',
  overlayLight: 'rgba(43,38,32,0.08)',
} as const;

export type ColorKey = keyof typeof colors;
