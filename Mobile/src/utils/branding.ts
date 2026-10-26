/**
 * A society's branding in the mobile app: the name, logo and one brand colour
 * a platform admin gave it. The palette maths mirrors Web/lib/branding.ts.
 *
 * This app's colours are baked into stylesheets when a screen loads, so the
 * whole app cannot be recoloured at runtime the way the web dashboard is.
 * Branding is applied where people look first — the home headers, the hero
 * card, the avatar — through this helper and the useBranding hook.
 */

export interface Branding {
  appName: string | null;
  /** "#RRGGBB" */
  primaryColor: string | null;
  /** PNG / JPEG / WebP data URI. */
  logoDataUri: string | null;
}

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type Shade = (typeof SHADES)[number];
type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const SAND_50: RGB = [239, 233, 220];
const SAND_100: RGB = [228, 218, 198];
const SAND_200: RGB = [211, 197, 169];

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]: RGB): string =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB;

/** Ten shades from the brand colour, which is shade 600. Same recipe as the web dashboard. */
export function buildPalette(hex: string): Record<Shade, string> {
  const base = hexToRgb(hex);
  return {
    50: toHex(mix(SAND_50, base, 0.05)),
    100: toHex(mix(SAND_100, base, 0.08)),
    200: toHex(mix(SAND_200, base, 0.12)),
    300: toHex(mix(base, WHITE, 0.52)),
    400: toHex(mix(base, WHITE, 0.3)),
    500: toHex(mix(base, WHITE, 0.12)),
    600: toHex(base),
    700: toHex(mix(base, BLACK, 0.22)),
    800: toHex(mix(base, BLACK, 0.4)),
    900: toHex(mix(base, BLACK, 0.55)),
  };
}

function luminance(hex: string): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Contrast of the colour against white, 1 to 21. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

export const MIN_CONTRAST_WITH_WHITE = 4.5;

export interface ResolvedBranding {
  /** The society's own name for the app, or null to show nothing extra. */
  appName: string | null;
  logoUri: string | null;
  /** Brand colour for fills that carry white text. Falls back to NG Home navy. */
  color: string;
  /** A soft tint of it, for chips and avatar backgrounds. */
  tint: string;
  /** Text on the tint. */
  onTint: string;
  /** True when the society has set anything at all. */
  branded: boolean;
}

/**
 * What to draw, given what the server returned and the app's own defaults.
 * A colour that fails the white-text contrast rule is ignored — the server
 * refuses those, but an old or hand-edited value must never make a screen unreadable.
 */
export function resolveBranding(
  raw: Partial<Branding> | null | undefined,
  defaults: { color: string; tint: string; onTint: string },
): ResolvedBranding {
  const appName = typeof raw?.appName === 'string' && raw.appName.trim() ? raw.appName.trim() : null;
  const logoUri = typeof raw?.logoDataUri === 'string' && raw.logoDataUri.startsWith('data:image/') ? raw.logoDataUri : null;
  const usable = isHexColor(raw?.primaryColor) && contrastWithWhite(raw!.primaryColor!) >= MIN_CONTRAST_WITH_WHITE;

  if (!usable) return { appName, logoUri, ...defaults, branded: !!(appName || logoUri) };
  const palette = buildPalette(raw!.primaryColor!);
  return { appName, logoUri, color: palette[600], tint: palette[100], onTint: palette[700], branded: true };
}
