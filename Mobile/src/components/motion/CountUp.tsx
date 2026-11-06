import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, Text, TextStyle } from 'react-native';
import { useAnimate } from './motion';

/**
 * A figure that counts up to its value, and from the old value to a new one when it changes (another month, a refresh).
 * It is one Text, with the formatted number and an optional suffix together, so it reads as a single piece of text.
 */
export function CountUp({
  value,
  format,
  suffix = '',
  style,
  duration = 800,
}: {
  value: number;
  format: (n: number) => string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const animate = useAnimate();
  const [shown, setShown] = useState(animate ? 0 : value);
  const current = useRef(animate ? 0 : value);

  useEffect(() => {
    if (!animate) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const driver = new Animated.Value(0);
    const id = driver.addListener(({ value: t }) => {
      const now = from + (value - from) * t;
      current.current = now;
      setShown(now);
    });
    const run = Animated.timing(driver, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    run.start(({ finished }) => {
      if (finished) {
        current.current = value;
        setShown(value);
      }
    });
    return () => {
      run.stop();
      driver.removeListener(id);
    };
  }, [value, animate, duration]);

  return <Text style={style}>{format(shown)}{suffix}</Text>;
}
