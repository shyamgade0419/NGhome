import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Tone, tint, tones } from '@/lib/tones';

export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  tone: Tone;
}

/** Shortcuts: a rounded square in the tone's soft colour with its icon, and a short label under it. */
export function QuickActions({ items }: { items: readonly QuickAction[] }) {
  return (
    <ul className="grid grid-cols-4 gap-x-2 gap-y-5 sm:grid-cols-6 lg:grid-cols-8">
      {items.map((a) => {
        const Icon = a.icon;
        return (
          <li key={a.label}>
            <Link href={a.href} className="group flex flex-col items-center gap-2 text-center focus-visible:outline-none">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-primary-500"
                style={{ backgroundColor: tint(tones[a.tone], 0.84), color: tones[a.tone] }}
              >
                <Icon size={24} />
              </span>
              <span className="text-xs font-semibold leading-tight text-slate-700">{a.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
