import React, { useEffect, useRef } from 'react';
import { Animated, DimensionValue, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/theme';
import { useAnimate } from './motion';

/** A grey block that pulses softly, standing in for something still loading. */
export function SkeletonBlock({ width = '100%', height = 16, borderRadius = radius.md, style }: { width?: DimensionValue; height?: number; borderRadius?: number; style?: StyleProp<ViewStyle> }) {
  const animate = useAnimate();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, pulse]);
  return <Animated.View style={[{ width, height, borderRadius, backgroundColor: colors.border, opacity: pulse }, style]} />;
}

/**
 * The home screen's shape drawn in grey while it loads: a hero card, a strip, and a grid of tiles. It tells the person
 * what is coming instead of showing a lone spinner, and the screen does not jump when the real content arrives.
 */
export function HomeSkeleton({ message = 'Loading...' }: { message?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']} accessibilityLabel={message}>
      <View style={styles.topBar}>
        <View style={{ gap: 6, flex: 1 }}>
          <SkeletonBlock width={90} height={12} />
          <SkeletonBlock width={180} height={16} />
        </View>
        <SkeletonBlock width={36} height={36} borderRadius={18} />
      </View>
      <View style={styles.body}>
        <SkeletonBlock height={170} borderRadius={24} />
        <SkeletonBlock height={92} borderRadius={20} />
        <View style={styles.row}>
          <SkeletonBlock height={104} borderRadius={18} style={{ flex: 1 }} />
          <SkeletonBlock height={104} borderRadius={18} style={{ flex: 1 }} />
        </View>
        <View style={styles.row}>
          <SkeletonBlock height={104} borderRadius={18} style={{ flex: 1 }} />
          <SkeletonBlock height={104} borderRadius={18} style={{ flex: 1 }} />
        </View>
        <Text style={styles.message}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  body: { padding: spacing.base, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  message: { textAlign: 'center', color: colors.textTertiary, marginTop: spacing.sm },
});
