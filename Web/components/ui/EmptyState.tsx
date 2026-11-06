import { LucideIcon } from 'lucide-react';
import { Tone, tint, tones } from '@/lib/tones';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** The colour of the picture. By default one is chosen from the title, so the same page is always the same colour. */
  tone?: Tone;
}

const TONES: Tone[] = ['teal', 'violet', 'blue', 'green', 'coral', 'amber'];

/** A stable colour for a piece of text: the same empty page is always the same colour, and different pages differ. */
export function toneForText(text: string): Tone {
  let h = 7;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export function EmptyState({ icon: Icon, title, description, action, tone }: EmptyStateProps) {
  const chosen = tone ?? toneForText(title);
  const color = tones[chosen];
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="relative h-32 w-32 motion-safe:animate-fade-up">
        <svg viewBox="0 0 132 132" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d="M22 62 C16 28 50 8 82 14 C114 20 128 48 120 78 C112 108 82 124 52 118 C30 112 26 88 22 62Z" fill={tint(color, 0.84)} />
          <circle cx="18" cy="98" r="6" fill={tint(color, 0.55)} />
          <circle cx="116" cy="22" r="5" fill={tint(color, 0.45)} />
          <circle cx="106" cy="112" r="4" fill={tint(tones.amber, 0.45)} />
          <path d="M24 21 L26 26 L31 28 L26 30 L24 35 L22 30 L17 28 L22 26Z" fill={tint(color, 0.3)} />
          <path d="M112 64 L113.7 68 L118 69.7 L113.7 71.4 L112 75.5 L110.3 71.4 L106 69.7 L110.3 68Z" fill={tint(tones.violet, 0.4)} />
        </svg>
        <div className="absolute left-1/2 top-1/2 flex h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md">
          <Icon size={30} style={{ color }} />
        </div>
      </div>
      <div>
        <p className="font-display font-bold text-slate-800">{title}</p>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
