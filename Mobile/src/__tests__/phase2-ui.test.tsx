/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 2 of the look: the count-up figure, the entrance, the skeleton, the drawn pictures, the empty screens and the
 * heading font. Motion is off in tests (NODE_ENV=test), so the animated paths are driven with a short real animation.
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

let mockAnimate = false;
jest.mock('@/components/motion/motion', () => ({
  motionEnabled: false,
  useReduceMotion: () => false,
  useAnimate: () => mockAnimate,
}));

import { CountUp } from '@/components/motion/CountUp';
import { FadeInUp } from '@/components/motion/FadeInUp';
import { HomeSkeleton } from '@/components/motion/Skeleton';
import { EmptyState, toneForIcon } from '@/components/ui/EmptyState';
import { PayScene, NoticeScene, GateScene, EmptyBackdrop } from '@/components/illustrations/scenes';
import { tones } from '@/theme/tones';
import { typography, fonts } from '@/theme/typography';

jest.useRealTimers();
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const trees: any[] = [];
async function render(el: React.ReactElement) {
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(el); });
  trees.push(tree);
  return tree;
}
afterEach(async () => { mockAnimate = false; await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('the count-up figure', () => {
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  it('shows its value and suffix as one piece of text, at once, when motion is off', async () => {
    const t = await render(<CountUp value={24349.44} format={rupees} suffix=" pending" />);
    expect(textOf(t.root)).toBe('₹24,349 pending');
    expect(t.root.findAllByType(Text)).toHaveLength(1);
  });

  it('follows a new value straight away when motion is off', async () => {
    const t = await render(<CountUp value={100} format={rupees} />);
    await act(async () => { t.update(<CountUp value={2500} format={rupees} />); });
    expect(textOf(t.root)).toBe('₹2,500');
  });

  it('counts up from zero to the value, and on to a new value, when motion is on', async () => {
    mockAnimate = true;
    const t = await render(<CountUp value={1000} format={rupees} duration={80} />);
    expect(textOf(t.root)).toBe('₹0'); // starts from nothing
    await wait(300);
    expect(textOf(t.root)).toBe('₹1,000');
    await act(async () => { t.update(<CountUp value={4000} format={rupees} duration={80} />); });
    await wait(300);
    expect(textOf(t.root)).toBe('₹4,000');
  });
});

describe('the entrance and the skeleton', () => {
  it('draws its children whether or not it animates', async () => {
    const still = await render(<FadeInUp><Text>Hello</Text></FadeInUp>);
    expect(textOf(still.root)).toBe('Hello');
    mockAnimate = true;
    const moving = await render(<FadeInUp delay={10}><Text>World</Text></FadeInUp>);
    expect(textOf(moving.root)).toBe('World');
  });

  it('shows the shape of the home screen with the message for anyone who cannot see it', async () => {
    const t = await render(<HomeSkeleton message="Loading dashboard..." />);
    expect(textOf(t.root)).toContain('Loading dashboard...');
    expect(t.root.findAll((n: any) => n.props.accessibilityLabel === 'Loading dashboard...').length).toBeGreaterThan(0);
  });
});

describe('the drawn pictures', () => {
  it('draw at the width they are given, in the ratio of their box, and are hidden from screen readers', async () => {
    for (const Scene of [PayScene, NoticeScene, GateScene]) {
      const t = await render(<Scene width={240} />);
      const svg = t.root.findAll((n: any) => n.props.viewBox === '0 0 320 240')[0];
      expect(svg.props.width).toBe(240);
      expect(svg.props.height).toBe(180);
      expect(svg.props.accessible).toBe(false);
    }
  });

  it('draws the backdrop of an empty screen in the colour asked for', async () => {
    const t = await render(<EmptyBackdrop tone="coral" size={100} />);
    const fills = t.root.findAll((n: any) => typeof n.props.fill === 'string').map((n: any) => n.props.fill.toUpperCase());
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((f: string) => /^#[0-9A-F]{6}$/.test(f))).toBe(true);
  });
});

describe('the empty screen', () => {
  it('shows its title, its description and an action that works', async () => {
    const onAction = jest.fn();
    const t = await render(<EmptyState icon="megaphone-outline" title="No announcements" description="Nothing has been posted yet." actionLabel="Post one" onAction={onAction} />);
    const text = textOf(t.root);
    expect(text).toContain('No announcements');
    expect(text).toContain('Nothing has been posted yet.');
    await act(async () => { t.root.findAll((n: any) => n.props.label === 'Post one' && typeof n.props.onPress === 'function')[0].props.onPress(); });
    expect(onAction).toHaveBeenCalled();
  });

  it('gives each icon a stable colour from the six accents, and different screens different colours', () => {
    const names = ['megaphone-outline', 'receipt-outline', 'people-outline', 'cube-outline', 'car-outline', 'calendar-outline', 'document-outline'];
    const picked = names.map(toneForIcon);
    expect(names.map(toneForIcon)).toEqual(picked); // the same every time
    picked.forEach((p) => expect(Object.keys(tones)).toContain(p));
    expect(new Set(picked).size).toBeGreaterThan(2);
  });
});

describe('the heading font', () => {
  it('puts headings and big figures in Plus Jakarta Sans and leaves body text and labels in the system font', () => {
    for (const k of ['displayLarge', 'displaySmall', 'headingLarge', 'headingMedium', 'headingSmall'] as const) {
      expect(Object.values(fonts)).toContain(typography[k].fontFamily);
      expect((typography[k] as any).fontWeight).toBeUndefined(); // the weight is in the font's name
    }
    for (const k of ['bodyLarge', 'bodyMedium', 'bodySmall', 'labelLarge', 'labelMedium', 'labelSmall'] as const) {
      expect(Object.values(fonts)).not.toContain(typography[k].fontFamily);
    }
  });
});
