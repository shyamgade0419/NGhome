/**
 * Per-society branding: the name, logo and colour a society's people see in
 * the NG Home web dashboard and mobile app.
 *
 * Stored inside SocietyConfiguration.additionalConfig.branding, so it needs
 * no migration. Only a platform admin sets it (see SocietyBrandingService);
 * a society admin's own config route merges a fixed list of keys and never
 * touches this one.
 */

export interface Branding {
  appName: string | null;
  /** "#RRGGBB" — the brand colour, which web and mobile derive their shades from. */
  primaryColor: string | null;
  /** A small PNG / JPEG / WebP as a data URI, so it rides along with the branding and needs no file hosting. */
  logoDataUri: string | null;
}

export const EMPTY_BRANDING: Branding = { appName: null, primaryColor: null, logoDataUri: null };

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Text on the brand colour is white, so the colour has to hold WCAG AA (4.5:1) against it. */
export const MIN_CONTRAST_WITH_WHITE = 4.5;

export const MAX_LOGO_BYTES = 200 * 1024;

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance of a "#RRGGBB" colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio of the colour against white, 1 (none) to 21 (black on white). */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

const DATA_URI = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The image kind a byte buffer really is, judged by its first bytes — never by what the data URI claims. */
function sniff(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}

export type LogoCheck = { ok: true } | { ok: false; reason: string };

/**
 * A logo is accepted only if it is a PNG, JPEG or WebP whose bytes really are
 * that kind of image, and small enough to ship inside every member's branding
 * response. SVG is refused on purpose: it can carry script, and the mobile
 * app cannot draw it anyway.
 */
export function checkLogo(dataUri: string): LogoCheck {
  const m = DATA_URI.exec(dataUri);
  if (!m) return { ok: false, reason: 'The logo must be a PNG, JPEG or WebP image.' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) return { ok: false, reason: 'The logo file is empty.' };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, reason: `The logo is ${Math.round(bytes.length / 1024)} KB. Please keep it under ${MAX_LOGO_BYTES / 1024} KB.` };
  }
  const real = sniff(bytes);
  if (real !== m[1]) return { ok: false, reason: 'That file is not really a PNG, JPEG or WebP image.' };
  return { ok: true };
}

/** What a stored additionalConfig holds for branding, tolerant of a missing or malformed value. */
export function readBranding(additionalConfig: unknown): Branding {
  const raw = (additionalConfig as { branding?: Partial<Branding> } | null | undefined)?.branding;
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BRANDING };
  return {
    appName: typeof raw.appName === 'string' && raw.appName ? raw.appName : null,
    primaryColor: typeof raw.primaryColor === 'string' && HEX_COLOR.test(raw.primaryColor) ? raw.primaryColor : null,
    logoDataUri: typeof raw.logoDataUri === 'string' && raw.logoDataUri ? raw.logoDataUri : null,
  };
}

/**
 * A copy of a configuration row with the logo removed from its additionalConfig.
 * Members read the configuration on many screens; the logo belongs only to the
 * branding endpoint, so it must not tag along on every one of those responses.
 */
export function scrubLogo<T extends { additionalConfig?: unknown }>(config: T | null | undefined): T | null | undefined {
  if (!config) return config;
  const extra = config.additionalConfig as { branding?: Record<string, unknown> } | null | undefined;
  if (!extra?.branding || !('logoDataUri' in extra.branding)) return config;
  const { logoDataUri, ...branding } = extra.branding;
  return { ...config, additionalConfig: { ...extra, branding: { ...branding, hasLogo: !!logoDataUri } } };
}
