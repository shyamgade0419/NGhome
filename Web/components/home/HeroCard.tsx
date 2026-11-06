'use client';

import { useBranding } from '@/components/BrandingProvider';
import { heroBackground } from '@/lib/tones';
import { cn } from '@/lib/utils';

/**
 * The card at the top of the dashboard: a gradient (the society's own colour if it has one) with a soft circle of light
 * in the corner, holding the one number that matters. Text on it is white.
 */
export function HeroCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const branding = useBranding();
  return (
    <section
      className={cn('relative overflow-hidden rounded-3xl p-5 text-white shadow-sm md:p-6', className)}
      style={{ background: heroBackground(branding?.primaryColor) }}
    >
      <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 right-24 hidden h-40 w-40 rounded-full bg-white/5 md:block" />
      <div className="relative">{children}</div>
    </section>
  );
}
