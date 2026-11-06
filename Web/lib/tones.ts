import { hexToRgb } from '@/lib/branding';

/**
 * The accent colours of the dashboard, the same six as the phone app (Mobile/src/theme/tones.ts). Each keeps one meaning
 * wherever it appears: blue is billing and money in, green is paid and approved, coral is money out, amber is waiting,
 * violet is notices and community, teal is places and people. Each is dark enough for a white icon on it to clear 3:1.
 */
export const tones = {
  blue: '#2563EB',
  green: '#0E9F6E',
  coral: '#E8644B',
  amber: '#C77C02',
  violet: '#7A5AF8',
  teal: '#0891B2',
} as const;

export type Tone = keyof typeof tones;

/** Navy deepening into teal: the hero card of a society that has not chosen its own colour. */
export const HERO_GRADIENT = 'linear-gradient(135deg, #0D2147 0%, #0B4F6C 55%, #0F766E 115%)';

type RGB = [number, number, number];
const toHex = ([r, g, b]: RGB): string => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const mixWith = (hex: string, other: RGB, amount: number): string => {
  const c = hexToRgb(hex);
  return toHex([0, 1, 2].map((i) => c[i] * (1 - amount) + other[i] * amount) as RGB);
};

/** The colour lightened towards white: a chip or card background that still reads as that colour. */
export const tint = (hex: string, amount = 0.86): string => mixWith(hex, [255, 255, 255], amount);
/** The colour darkened towards black. */
export const deepen = (hex: string, amount = 0.35): string => mixWith(hex, [0, 0, 0], amount);

/** The hero card's background: the society's own colour deepening into a darker shade of itself, else the NG Home gradient. */
export function heroBackground(brandColor: string | null | undefined): string {
  return brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor)
    ? `linear-gradient(135deg, ${brandColor} 0%, ${deepen(brandColor, 0.38)} 100%)`
    : HERO_GRADIENT;
}
