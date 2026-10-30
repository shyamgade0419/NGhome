'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { GUIDE, GUIDE_UPDATED, sectionText } from '@/lib/guide';
import type { Block, GuideSection } from '@/lib/guide';
import { cn } from '@/lib/utils';

/** **bold** and `code` inside a line of guide text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <strong key={i} className="font-semibold text-slate-900">{p.slice(2, -2)}</strong>
        ) : p.startsWith('`') ? (
          <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-slate-800">{p.slice(1, -1)}</code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case 'p':
      return <p className="text-sm leading-relaxed text-slate-700"><Inline text={b.text} /></p>;
    case 'steps':
      return (
        <ol className="list-none space-y-2.5 pl-0">
          {b.items.map((t, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">{i + 1}</span>
              <span><Inline text={t} /></span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="list-none space-y-2 pl-0">
          {b.items.map((t, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-700">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-500" />
              <span><Inline text={t} /></span>
            </li>
          ))}
        </ul>
      );
    case 'tip':
      return (
        <p className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-xs leading-relaxed text-primary-700">
          <span className="font-semibold">Tip. </span><Inline text={b.text} />
        </p>
      );
    case 'warn':
      return (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          <span className="font-semibold">Note. </span><Inline text={b.text} />
        </p>
      );
    case 'shot':
      return (
        <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Plain img: these are fixed screenshots shipped in /public/help, nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.src} alt={b.alt} loading="lazy" className="h-auto w-full" />
          <figcaption className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">{b.caption}</figcaption>
        </figure>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[420px] border-collapse text-left text-xs">
            <thead>
              <tr className="bg-slate-50">
                {b.head.map((h, i) => <th key={i} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  {r.map((c, j) => (
                    <td key={j} className={cn('px-3 py-2 leading-relaxed', j === 0 ? 'font-medium text-slate-800' : 'text-slate-600')}><Inline text={c} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function SectionCard({ s, forceOpen }: { s: GuideSection; forceOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const isOpen = open || forceOpen;
  return (
    <div id={`guide-${s.id}`} className={cn('overflow-hidden rounded-xl border bg-white shadow-sm', isOpen ? 'border-primary-200' : 'border-slate-200')}>
      <button onClick={() => setOpen(!isOpen)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50" aria-expanded={isOpen}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{s.title}</p>
          <p className="truncate text-xs text-slate-500">{s.summary}</p>
        </div>
        <span className="flex-shrink-0 text-slate-400">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {isOpen && (
        <div className="space-y-4 border-t border-slate-100 px-5 py-5">
          {s.blocks.map((b, i) => <BlockView key={i} b={b} />)}
        </div>
      )}
    </div>
  );
}

/**
 * The complete user guide inside the app: every part and section of lib/guide.ts, with screenshots.
 * `audience` filters to admin or resident sections; `query` filters by text and opens what matches.
 */
export function GuideView({ query, audience }: { query: string; audience: 'admin' | 'resident' }) {
  const parts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GUIDE.map((part) => ({
      ...part,
      sections: part.sections.filter((s) => {
        if (audience === 'admin' && s.audience === 'resident') return false;
        if (audience === 'resident' && s.audience === 'admin') return false;
        return !q || sectionText(s).includes(q);
      }),
    })).filter((p) => p.sections.length > 0);
  }, [query, audience]);

  if (parts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
        <p className="text-sm font-medium text-slate-600">Nothing in the guide matches &ldquo;{query}&rdquo;</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {parts.map((p) => (
        <section key={p.id} className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">{p.title}</h2>
            <p className="text-xs text-slate-500">{p.intro}</p>
          </div>
          {p.sections.map((s) => <SectionCard key={s.id} s={s} forceOpen={query.trim().length > 0} />)}
        </section>
      ))}
      <p className="text-[11px] text-slate-400">
        Last updated {GUIDE_UPDATED}. The same guide is on the website at{' '}
        <a href="https://www.novagade.in/help" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">novagade.in/help</a>.
      </p>
    </div>
  );
}
