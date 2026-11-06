/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The building blocks of the home screens: the colour helpers, the swipe strip (cards, dots, tapping, moving on by
 * itself and stopping when touched), the ring, the tinted tiles and the shortcut grid.
 */

import React from 'react';
import { FlatList, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/useBranding', () => ({ useBranding: () => ({ color: '#0D2147', tint: '#eee', onTint: '#111' }) }));

import { tint, deepen, heroColors, HERO_GRADIENT, tones } from '@/theme/tones';
import { UpdatesCarousel, UpdateItem } from '@/components/home/UpdatesCarousel';
import { ProgressRing } from '@/components/home/ProgressRing';
import { TintStatTile } from '@/components/home/TintStatTile';
import { ActionGrid } from '@/components/home/ActionGrid';
import { HeroCard } from '@/components/home/HeroCard';

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');

const items = (n: number): UpdateItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, tone: 'violet' as const, icon: 'megaphone-outline' as const, title: `Card ${i}`, subtitle: `Sub ${i}`, cta: 'Open', onPress: jest.fn() }));

const trees: any[] = [];
afterEach(async () => {
  jest.useRealTimers();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});
async function render(el: React.ReactElement) {
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(el); });
  trees.push(tree);
  return tree;
}

describe('colour helpers', () => {
  it('lightens towards white and darkens towards black, as hex', () => {
    expect(tint('#000000', 1)).toBe('#FFFFFF');
    expect(tint('#FFFFFF', 0.5)).toBe('#FFFFFF');
    expect(tint('#0E9F6E', 0)).toBe('#0E9F6E');
    expect(deepen('#FFFFFF', 1)).toBe('#000000');
    expect(deepen('#204080', 0.5)).toBe('#102040');
    expect(tint(tones.blue)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('uses the NG Home gradient unless the society has a colour of its own', () => {
    expect(heroColors('#0D2147', '#0D2147')).toBe(HERO_GRADIENT);
    expect(heroColors('#0d2147', '#0D2147')).toBe(HERO_GRADIENT); // case does not matter
    const own = heroColors('#B03060', '#0D2147');
    expect(own[0]).toBe('#B03060');
    expect(own).toHaveLength(2);
    expect(own[1]).not.toBe('#B03060');
  });

  it('keeps every accent dark enough for a white icon on it (3:1)', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const [name, hex] of Object.entries(tones)) {
      expect({ name, ratio: 1.05 / (lum(hex) + 0.05) >= 3 }).toEqual({ name, ratio: true });
    }
  });
});

describe('the swipe strip', () => {
  it('shows nothing with no cards, and no dots for a single card', async () => {
    expect((await render(<UpdatesCarousel items={[]} />)).toJSON()).toBeNull();
    const one = await render(<UpdatesCarousel items={items(1)} />);
    expect(textOf(one.root)).toContain('Card 0');
    expect(one.root.findAll((n: any) => n.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(0);
  });

  it('lists its cards with their text, and one dot for each', async () => {
    const tree = await render(<UpdatesCarousel items={items(3)} />);
    const text = textOf(tree.root);
    for (const t of ['Card 0', 'Sub 1', 'Card 2']) expect(text).toContain(t);
    const dots = tree.root.findAll((n: any) => n.type === 'View' && n.props.importantForAccessibility === 'no-hide-descendants')[0];
    expect(dots.children).toHaveLength(3);
  });

  it('opens the card that is tapped', async () => {
    const list = items(2);
    const tree = await render(<UpdatesCarousel items={list} />);
    await act(async () => { tree.root.findAllByType(TouchableOpacity)[1].props.onPress(); });
    expect(list[1].onPress).toHaveBeenCalledTimes(1);
    expect(list[0].onPress).not.toHaveBeenCalled();
  });

  it('moves on by itself until it is touched, then stays where the person put it', async () => {
    jest.useFakeTimers();
    const tree = await render(<UpdatesCarousel items={items(3)} intervalMs={1000} />);
    const flat = tree.root.findByType(FlatList);
    const scroll = jest.fn();
    // The strip scrolls through its list ref: capture what it asks for.
    (flat.instance as any).scrollToOffset = scroll;
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0].offset).toBeGreaterThan(0);

    await act(async () => { flat.props.onScrollBeginDrag(); }); // a finger on it
    scroll.mockClear();
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not move by itself with a single card', async () => {
    jest.useFakeTimers();
    const tree = await render(<UpdatesCarousel items={items(1)} intervalMs={500} />);
    const scroll = jest.fn();
    (tree.root.findByType(FlatList).instance as any).scrollToOffset = scroll;
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('ring, tiles, grid and hero', () => {
  it('names the share it shows, and clamps nonsense to a full or empty ring', async () => {
    const ring = await render(<ProgressRing fraction={0.21} label="21%" accessibilityLabel="21 percent collected" />);
    expect(ring.root.findAll((n: any) => n.props.accessibilityLabel === '21 percent collected').length).toBeGreaterThan(0);
    const circles = (t: any) => t.root.findAll((n: any) => n.props.strokeDashoffset !== undefined);
    const dash = (fraction: number) => render(<ProgressRing fraction={fraction} label="x" />).then((t) => Number(circles(t)[0].props.strokeDashoffset));
    const full = await dash(5);
    const empty = await dash(-3);
    const nan = await dash(Number.NaN);
    expect(full).toBeCloseTo(0, 5);
    expect(empty).toBeGreaterThan(100);
    expect(nan).toBeCloseTo(empty, 5);
  });

  it('shows a tile with its label, figure and progress, and presses through when it can', async () => {
    const press = jest.fn();
    const tile = await render(<TintStatTile tone="green" icon="trending-up-outline" label="Collected" value="₹6.5K" progress={0.21} onPress={press} />);
    expect(textOf(tile.root)).toContain('Collected');
    expect(textOf(tile.root)).toContain('₹6.5K');
    await act(async () => { tile.root.findByType(TouchableOpacity).props.onPress(); });
    expect(press).toHaveBeenCalled();
    const plain = await render(<TintStatTile tone="blue" icon="receipt-outline" label="Total" value="₹1" />);
    expect(plain.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  });

  it('opens the route of the shortcut that is tapped', async () => {
    const open = jest.fn();
    const grid = await render(<ActionGrid onOpen={open} items={[{ label: 'Billing', icon: 'receipt-outline', tone: 'blue', route: '/billing' }, { label: 'Verify', icon: 'checkmark-circle-outline', tone: 'green', route: '/verify' }]} />);
    expect(textOf(grid.root)).toContain('Billing');
    await act(async () => { grid.root.findAllByType(TouchableOpacity)[1].props.onPress(); });
    expect(open).toHaveBeenCalledWith('/verify');
  });

  it('draws its children inside the hero card', async () => {
    const { Text } = require('react-native');
    const hero = await render(<HeroCard><Text>₹24,349 pending</Text></HeroCard>);
    expect(textOf(hero.root)).toContain('₹24,349 pending');
  });
});
