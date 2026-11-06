import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { PayScene, NoticeScene, GateScene } from '@/components/illustrations/scenes';
import { useAnimate } from '@/components/motion/motion';
import { markWelcomeSeen } from '@/onboarding/welcome';
import { colors, radius, spacing, typography } from '@/theme';
import { Tone, tones } from '@/theme/tones';

interface Slide {
  id: string;
  tone: Tone;
  title: string;
  body: string;
  Scene: React.ComponentType<{ width?: number }>;
}

export const WELCOME_SLIDES: Slide[] = [
  { id: 'pay', tone: 'blue', Scene: PayScene, title: 'Pay maintenance in a tap', body: 'See what you owe, pay by UPI and tell the society once it is done. Your receipt is there as soon as it is approved.' },
  { id: 'notices', tone: 'violet', Scene: NoticeScene, title: 'Always know what is happening', body: 'Notices, meetings and events from your society reach your phone, so nothing gets missed.' },
  { id: 'gate', tone: 'coral', Scene: GateScene, title: 'Visitors and deliveries, handled', body: 'Approve a visitor from your phone, keep track of parcels, and manage your household help and vehicles.' },
];

/** A picture that floats up and down a few pixels, slowly. Still when the phone is set to reduce motion. */
function Floating({ children }: { children: React.ReactNode }) {
  const animate = useAnimate();
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -8, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, y]);
  return <Animated.View style={{ transform: [{ translateY: y }] }}>{children}</Animated.View>;
}

/** Three slides on what the app does, shown once on a new phone before the sign-in screen. */
export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const last = index === WELCOME_SLIDES.length - 1;

  const finish = async () => {
    await markWelcomeSeen();
    router.replace('/(auth)/login');
  };
  const next = () => {
    if (last) void finish();
    else list.current?.scrollToIndex({ index: index + 1, animated: true });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.max(0, Math.min(WELCOME_SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))));
  };
  const artWidth = Math.min(width - 48, 340);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => void finish()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip the introduction">
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={list}
        data={WELCOME_SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.id}
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <Floating>
              <item.Scene width={artWidth} />
            </Floating>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.bottom}>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {WELCOME_SLIDES.map((s, i) => (
            <View key={s.id} style={[styles.dot, i === index && { width: 22, backgroundColor: tones[WELCOME_SLIDES[index].tone] }]} />
          ))}
        </View>
        <Button label={last ? 'Get started' : 'Next'} onPress={next} fullWidth size="lg" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  top: { alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, minHeight: 36 },
  skip: { ...typography.labelLarge, color: colors.textSecondary },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { ...typography.displaySmall, color: colors.text, textAlign: 'center', marginTop: spacing.lg },
  body: { ...typography.bodyLarge, color: colors.textSecondary, textAlign: 'center', maxWidth: 340 },
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: 'rgba(43,38,32,0.2)' },
});
