/**
 * A society's branding in the web dashboard: its name, logo and one brand
 * colour. Set by a platform admin (see the platform console); read here after
 * sign-in. The palette maths mirrors Mobile/src/utils/branding.ts.
 *
 * Tailwind's `primary-*` classes read CSS variables (tailwind.config.ts), so
 * recolouring the whole dashboard is just setting ten variables.
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
// The warm sand the app's light surfaces sit on. The brand tints these rather
// than replacing them, so a branded society still looks like it belongs on the beige.
const SAND_50: RGB = [239, 233, 220];
const SAND_100: RGB = [228, 218, 198];
const SAND_200: RGB = [211, 197, 169];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB;

/** The ten shades derived from the brand colour, which is shade 600 — the one buttons and active items use. */
export function buildPalette(hex: string): Record<Shade, RGB> {
  const base = hexToRgb(hex);
  return {
    50: mix(SAND_50, base, 0.05),
    100: mix(SAND_100, base, 0.08),
    200: mix(SAND_200, base, 0.12),
    300: mix(base, WHITE, 0.52),
    400: mix(base, WHITE, 0.3),
    500: mix(base, WHITE, 0.12),
    600: base,
    700: mix(base, BLACK, 0.22),
    800: mix(base, BLACK, 0.4),
    900: mix(base, BLACK, 0.55),
  };
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Points the dashboard's `primary-*` colours at this brand colour. */
export function applyBrandColor(hex: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!isHexColor(hex)) {
    SHADES.forEach((s) => root.style.removeProperty(`--primary-${s}`));
    return;
  }
  const palette = buildPalette(hex);
  SHADES.forEach((s) => root.style.setProperty(`--primary-${s}`, palette[s].join(' ')));
}

/** WCAG relative luminance of a "#RRGGBB" colour. */
function luminance(hex: string): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Contrast of the colour against white, 1 to 21. Buttons and active items put white text on it. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** The server refuses anything below this, so the console checks it first. */
export const MIN_CONTRAST_WITH_WHITE = 4.5;
export const MAX_LOGO_BYTES = 200 * 1024;
