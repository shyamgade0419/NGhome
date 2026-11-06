import { useRef } from 'react';
import { Animated } from 'react-native';
import { useAnimate } from './motion';

/**
 * A small press effect: the thing shrinks a touch under the finger and springs back. Put `style` on an Animated.View
 * around the pressable and the two handlers on the pressable itself. With motion off it does nothing.
 */
export function usePressScale(to = 0.96) {
  const animate = useAnimate();
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (value: number) => Animated.spring(scale, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => {
      if (animate) spring(to);
    },
    onPressOut: () => {
      if (animate) spring(1);
    },
  };
}
