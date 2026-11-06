/** Slides its children up a little while fading in, once, when the page draws. `delay` (ms) staggers a run of them. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`motion-safe:animate-fade-up ${className ?? ''}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
