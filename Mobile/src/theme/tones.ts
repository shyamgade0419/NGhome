import { hexToRgb } from '@/utils/branding';

/**
 * The accent colours of the home screens. Each one keeps one meaning wherever it appears, so colour carries information
 * and is not just decoration: blue is billing and money in, green is paid and approved, coral is money out, amber is
 * waiting, violet is notices and community, teal is places and bookings.
 *
 * Each is dark enough for a white icon on it to clear 3:1 (the bar for icons), and its soft `tint` is for the chip or card
 * behind it. The navy `colors.primary` stays the anchor of the brand and of the hero card.
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
export const HERO_GRADIENT = ['#0D2147', '#0B4F6C', '#0F766E'] as const;

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

/**
 * The hero card's gradient. A society with its own brand colour gets that colour deepening into a darker shade of
 * itself; every other society gets the NG Home gradient.
 */
export function heroColors(brandColor: string, defaultColor: string): readonly [string, string, ...string[]] {
  return brandColor.toUpperCase() === defaultColor.toUpperCase() ? HERO_GRADIENT : [brandColor, deepen(brandColor, 0.38)];
}
