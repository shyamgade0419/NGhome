'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A figure that counts up to its value, and from the old value to a new one when it changes (another month). It shows
 * the value at once when the device is set to reduce motion. `null` shows a dash.
 */
export function CountUpNumber({ value, format, duration = 800 }: { value: number | null; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState<number | null>(value);
  const current = useRef<number>(0);

  useEffect(() => {
    if (value === null) {
      setShown(null);
      return;
    }
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * eased;
      current.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{shown === null ? '—' : format(shown)}</>;
}
