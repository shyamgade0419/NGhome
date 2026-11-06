import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the app animates at all. Tests run without it, so a screen under test shows its final state at once instead of
 * waiting for a count-up or a fade; a phone set to "reduce motion" gets the same, through `useAnimate`.
 */
export const motionEnabled = process.env.NODE_ENV !== 'test';

/** The device's "reduce motion" setting. False until the phone says otherwise. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (!motionEnabled) return;
    let alive = true;
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
        .then((v) => alive && setReduce(!!v))
        .catch(() => undefined);
    } catch {
      // A phone that cannot say is treated as not reducing motion.
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/** True when things should animate: the app has motion on and the person has not asked for less. */
export function useAnimate(): boolean {
  const reduce = useReduceMotion();
  return motionEnabled && !reduce;
}
