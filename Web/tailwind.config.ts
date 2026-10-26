import type { Config } from 'tailwindcss';

/**
 * Warm beige canvas, navy brand — matched to Mobile/src/theme/colors.ts.
 *
 * Two things are going on here.
 *
 * First, `primary` was a generic Tailwind blue (#2563EB) with no relationship
 * to the brand, so the web app looked like a different product from the phone
 * app and the login/splash screens. It's now the same navy as the app icon,
 * splash and mobile theme (#0D2147).
 *
 * Second, `slate` is deliberately overridden rather than extended. The app
 * uses slate-* around 900 times across 46 files for every background, border
 * and body text; re-pointing the scale itself turns the whole surface warm in
 * one place, instead of editing hundreds of class names and leaving the next
 * component to reintroduce the cool grey. Shade *roles* are unchanged — 50 is
 * still the lightest canvas, 900 still body text — so no markup has to change.
 *
 * Contrast is checked against white and slate-50, not assumed. slate-500 (the
 * most-used text colour, ~193 usages) holds 5.2:1, slate-600 7.4:1, slate-900
 * 14.9:1, and primary-600 15.8:1 — all clear of WCAG AA's 4.5:1. slate-400 is
 * placeholder/disabled text at 3.2:1, which clears AA-large and is a shade
 * better than stock Tailwind slate-400's 2.8:1.
 *
 * The full primary ramp is defined on purpose: primary-300, -400 and -800 were
 * referenced 21 times in the app but had never been declared, so those classes
 * silently resolved to nothing.
 */
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Navy. The light end (50–200) is warm sand rather than pale blue:
        // these shades are used as backgrounds behind navy text (active nav
        // items, badges), and a cool blue chip on a beige card reads as
        // something pasted in from another design.
        // Each shade reads a CSS variable so a society can carry its own brand
        // colour (lib/branding.ts sets them after login). The defaults in
        // globals.css are exactly the navy below, so nothing changes until a
        // society has a colour. <alpha-value> keeps bg-primary-600/10 working.
        primary: {
          DEFAULT: 'rgb(var(--primary-600) / <alpha-value>)',
          50: 'rgb(var(--primary-50) / <alpha-value>)',
          100: 'rgb(var(--primary-100) / <alpha-value>)',
          200: 'rgb(var(--primary-200) / <alpha-value>)',
          300: 'rgb(var(--primary-300) / <alpha-value>)',
          400: 'rgb(var(--primary-400) / <alpha-value>)',
          500: 'rgb(var(--primary-500) / <alpha-value>)',
          600: 'rgb(var(--primary-600) / <alpha-value>)',
          700: 'rgb(var(--primary-700) / <alpha-value>)',
          800: 'rgb(var(--primary-800) / <alpha-value>)',
          900: 'rgb(var(--primary-900) / <alpha-value>)',
        },
        // Warm neutral ramp replacing Tailwind's cool slate.
        slate: {
          50: '#FAF6EE',
          100: '#F4EEE2',
          200: '#E8DFCD',
          300: '#D6C9B0',
          400: '#9C8D75',
          500: '#776B5B',
          600: '#5E5445',
          700: '#473F35',
          800: '#37312A',
          900: '#2B2620',
        },
        // Brand green, matching mobile's `secondary`. Amber and red are pulled
        // warm so alerts belong to the beige rather than fluorescing on it.
        success: { DEFAULT: '#2F6E2E', light: '#E7EFDE' },
        warning: { DEFAULT: '#B45309', light: '#FBEBD7' },
        error: { DEFAULT: '#C2410C', light: '#FBE3D8' },
        // Terracotta — a third brand-adjacent colour for things that need to
        // be distinguishable without implying a status, mirroring mobile's
        // `accent`. Navy and green are both already load-bearing.
        accent: { DEFAULT: '#A85A32', light: '#F6E4DA' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
