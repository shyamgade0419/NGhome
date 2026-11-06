'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tone, tint, tones } from '@/lib/tones';
import { cn } from '@/lib/utils';

export interface UpdateItem {
  id: string;
  tone: Tone;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** The small call to action under the text, e.g. "Review now". */
  cta?: string;
  href?: string;
}

const GAP = 12;

/**
 * A strip of cards that swipe sideways (or scroll with the arrows on a computer), with dots. The next card peeks in from
 * the right so it is clear there is more. It moves on by itself every few seconds until the person touches, hovers or
 * focuses it, and not at all when the device is set to reduce motion.
 */
export function UpdatesStrip({ items, intervalMs = 5000 }: { items: UpdateItem[]; intervalMs?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const count = items.length;

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(q.matches);
    const on = () => setReduceMotion(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);

  const cardStep = useCallback(() => {
    const first = scroller.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + GAP : 0;
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el || count === 0) return;
      const target = ((i % count) + count) % count;
      el.scrollTo({ left: target * cardStep(), behavior: reduceMotion ? 'auto' : 'smooth' });
    },
    [count, cardStep, reduceMotion],
  );

  const activeRef = useRef(0);
  activeRef.current = active;
  useEffect(() => {
    if (count < 2 || stopped || hovered || reduceMotion) return;
    const timer = setInterval(() => goTo(activeRef.current + 1), intervalMs);
    return () => clearInterval(timer);
  }, [count, stopped, hovered, reduceMotion, goTo, intervalMs]);

  if (count === 0) return null;

  const onScroll = () => {
    const el = scroller.current;
    const step = cardStep();
    if (!el || !step) return;
    setActive(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / step))));
  };

  return (
    <div
      role="region"
      aria-label="What is happening"
      className="group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={scroller}
        tabIndex={0}
        onScroll={onScroll}
        onPointerDown={() => setStopped(true)}
        onWheel={() => setStopped(true)}
        onKeyDown={(e) => {
          setStopped(true);
          if (e.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1); }
        }}
        className="flex snap-x snap-mandatory overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl [&::-webkit-scrollbar]:hidden"
        style={{ gap: GAP }}
      >
        {items.map((item) => {
          const color = tones[item.tone];
          const Icon = item.icon;
          const body = (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: color }}>
                <Icon size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-sm font-bold leading-snug text-slate-900 line-clamp-2">{item.title}</span>
                {item.subtitle && <span className="mt-0.5 block text-xs leading-snug text-slate-600 line-clamp-2">{item.subtitle}</span>}
                {item.cta && <span className="mt-1.5 block text-xs font-bold" style={{ color }}>{item.cta} →</span>}
              </span>
            </>
          );
          const style = { backgroundColor: tint(color, 0.88), borderColor: tint(color, 0.72) };
          const cls = 'flex min-h-[92px] w-[85%] shrink-0 snap-start items-center gap-3 rounded-2xl border p-4 sm:w-[340px]';
          return item.href ? (
            <Link key={item.id} href={item.href} className={cn(cls, 'transition-shadow hover:shadow-md')} style={style}>
              {body}
            </Link>
          ) : (
            <div key={item.id} className={cls} style={style}>
              {body}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => { setStopped(true); goTo(active - 1); }}
            aria-label="Previous update"
            className="absolute left-1 top-[46px] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-white md:group-hover:flex"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setStopped(true); goTo(active + 1); }}
            aria-label="Next update"
            className="absolute right-1 top-[46px] hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm hover:bg-white md:group-hover:flex"
          >
            <ChevronRight size={16} />
          </button>
          <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
            {items.map((it, i) => (
              <span key={it.id} className={cn('h-1.5 rounded-full transition-all', i === active ? 'w-5 bg-primary-600' : 'w-1.5 bg-slate-300')} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
