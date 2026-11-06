import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, AccessibilityInfo, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Tone, tint, tones } from '@/theme/tones';

export interface UpdateItem {
  id: string;
  tone: Tone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  /** The small call to action under the text, e.g. "Review now". */
  cta?: string;
  onPress?: () => void;
}

const GAP = 10;

/**
 * A strip of cards that swipe sideways, with dots. The next card peeks in from the right so it is clear there is more.
 * It moves on by itself every few seconds until the person touches it, and not at all when the phone is set to reduce motion.
 */
export function UpdatesCarousel({ items, intervalMs = 5000 }: { items: UpdateItem[]; intervalMs?: number }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(width * 0.84);
  const step = cardWidth + GAP;
  const list = useRef<FlatList<UpdateItem>>(null);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
        .then((v) => alive && setReduceMotion(!!v))
        .catch(() => undefined);
    } catch {
      // A phone that cannot say is treated as not reducing motion.
    }
    return () => {
      alive = false;
    };
  }, []);

  const count = items.length;
  const activeRef = useRef(0);
  activeRef.current = active;
  useEffect(() => {
    if (count < 2 || touched || reduceMotion) return;
    const timer = setInterval(() => {
      const next = (activeRef.current + 1) % count;
      list.current?.scrollToOffset({ offset: next * step, animated: true });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [count, touched, reduceMotion, step, intervalMs]);

  if (count === 0) return null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / step);
    setActive(Math.max(0, Math.min(count - 1, i)));
  };

  return (
    <View accessibilityLabel="Updates">
      <FlatList
        ref={list}
        data={items}
        horizontal
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => setTouched(true)}
        renderItem={({ item }) => {
          const color = tones[item.tone];
          return (
            <TouchableOpacity
              activeOpacity={item.onPress ? 0.85 : 1}
              disabled={!item.onPress}
              onPress={item.onPress}
              accessibilityRole={item.onPress ? 'button' : undefined}
              style={[styles.card, { width: cardWidth, backgroundColor: tint(color, 0.86), borderColor: tint(color, 0.7) }]}
            >
              <View style={[styles.icon, { backgroundColor: color }]}>
                <Ionicons name={item.icon} size={22} color="#FFFFFF" />
              </View>
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {!!item.subtitle && <Text style={styles.subtitle} numberOfLines={2}>{item.subtitle}</Text>}
                {!!item.cta && <Text style={[styles.cta, { color }]}>{item.cta} →</Text>}
              </View>
            </TouchableOpacity>
          );
        }}
      />
      {count > 1 && (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {items.map((it, i) => (
            <View key={it.id} style={[styles.dot, i === active && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, paddingVertical: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 92, borderRadius: 20, padding: spacing.base, borderWidth: 1 },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  title: { ...typography.labelLarge, color: colors.text, fontWeight: '700' },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  cta: { ...typography.labelMedium, fontWeight: '700', marginTop: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(43,38,32,0.2)' },
  dotOn: { width: 20, backgroundColor: colors.primary },
});
