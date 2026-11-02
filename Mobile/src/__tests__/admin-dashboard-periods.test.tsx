/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The admin dashboard shows one billing month at a time. It opens on the newest published period (the one in use), not on
 * the phone's calendar month: on the 1st of a new month that month has no bills, so every figure read zero while the
 * month in use had real numbers. The admin steps to earlier months by arrow or swipe.
 */

import React from 'react';
import { PanResponder, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSummary = jest.fn();

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    listPublishedPeriods: jest.fn(async () => [
      { id: 'p3', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY' },
      { id: 'p2', periodYear: 2026, periodMonth: 9, status: 'PUBLISHED', kind: 'MONTHLY' },
      { id: 'p1', periodYear: 2026, periodMonth: 8, status: 'PUBLISHED', kind: 'MONTHLY' },
      { id: 'p0', periodYear: 2026, periodMonth: 3, status: 'PUBLISHED', kind: 'OPENING' },
    ]),
    getCurrentPeriod: jest.fn(async () => ({ id: 'p3', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY' })),
    getDashboardSummary: (...a: unknown[]) => mockSummary(...a),
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View: V } = jest.requireActual('react-native');
  return { SafeAreaView: V };
});
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Priya', lastName: 'Nair' } }) }));
jest.mock('@/hooks/useBranding', () => ({ useBranding: () => ({ color: '#111', tint: '#eee', onTint: '#111' }) }));
jest.mock('@/components/ui/NotificationBell', () => ({ NotificationBell: () => null }));
jest.mock('@/components/ui/BrandMark', () => ({ BrandMark: () => null }));

import AdminDashboard from '../../app/(app)/admin/index';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const arrow = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).find((n: any) => n.props.accessibilityLabel === label);

const trees: any[] = [];
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><AdminDashboard /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('Financial Overview'));
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});
beforeEach(() => {
  mockSummary.mockReset();
  mockSummary.mockImplementation(async (p: { year: number; month: number }) => ({
    totalBilled: p.month === 10 ? '30880.01' : p.month === 9 ? '28000' : '0',
    totalCollected: '6530.57', totalOutstanding: '24349.44', totalExpenses: '18920', accountBalance: '258852.01', corpusBalance: '200000', pendingApprovals: 0,
  }));
});

describe('the admin dashboard and its billing month', () => {
  it('opens on the newest published period, never on a calendar month that has no bills', async () => {
    const tree = await mount();
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(mockSummary).toHaveBeenCalledWith({ year: 2026, month: 10 });
    const text = textOf(tree.root);
    expect(text).toContain('Current Billing Period');
    expect(text).toContain('Financial Overview — October 2026');
    expect(text).toContain('Swipe, or tap the arrows');
  });

  it('steps to an earlier month by the arrow, shows its figures, and can step forward again', async () => {
    const tree = await mount();
    expect(arrow(tree, 'Later billing period').props.disabled).toBe(true); // already on the newest
    await act(async () => { arrow(tree, 'Earlier billing period').props.onPress(); });
    await until(() => mockSummary.mock.calls.some((c) => c[0].month === 9));
    expect(textOf(tree.root)).toContain('Financial Overview — September 2026');
    expect(textOf(tree.root)).toContain('Billing Period'); // no longer "Current"
    expect(textOf(tree.root)).not.toContain('Current Billing Period');

    await act(async () => { arrow(tree, 'Earlier billing period').props.onPress(); });
    await until(() => textOf(tree.root).includes('August 2026'));
    // The opening-balance period is not a month to browse to.
    expect(arrow(tree, 'Earlier billing period').props.disabled).toBe(true);

    await act(async () => { arrow(tree, 'Later billing period').props.onPress(); });
    await until(() => textOf(tree.root).includes('Financial Overview — September 2026'));
  });

  it('turns the page on a swipe: right for the earlier month, left for the later one', async () => {
    // The gesture rules the screen gave to React Native's PanResponder, captured so they can be driven directly.
    let rules: any;
    const spy = jest.spyOn(PanResponder, 'create').mockImplementation((cfg: any) => { rules = cfg; return { panHandlers: {} } as any; });
    const tree = await mount();
    spy.mockRestore();
    expect(rules).toBeDefined();
    const release = (dx: number) => act(async () => { rules.onPanResponderRelease({}, { dx, dy: 0 }); });
    // The responder is claimed only by a clearly horizontal drag, so vertical scrolling is left alone.
    expect(rules.onMoveShouldSetPanResponder({}, { dx: 40, dy: 4 })).toBe(true);
    expect(rules.onMoveShouldSetPanResponder({}, { dx: 40, dy: 60 })).toBe(false);
    expect(rules.onMoveShouldSetPanResponder({}, { dx: 8, dy: 0 })).toBe(false);

    await release(120);
    await until(() => textOf(tree.root).includes('Financial Overview — September 2026'));
    await release(20); // a small movement is not a swipe
    expect(textOf(tree.root)).toContain('September 2026');
    await release(-120);
    await until(() => textOf(tree.root).includes('Financial Overview — October 2026'));
  });

  it('falls back to the calendar month when there are no published periods yet, with nothing to browse', async () => {
    const api = require('@/api/endpoints/billing.api').billingApi;
    api.listPublishedPeriods.mockResolvedValueOnce([]);
    api.getCurrentPeriod.mockResolvedValueOnce(null);
    const tree = await mount();
    const now = new Date();
    expect(mockSummary).toHaveBeenCalledWith({ year: now.getFullYear(), month: now.getMonth() + 1 });
    expect(arrow(tree, 'Earlier billing period')).toBeUndefined();
    expect(textOf(tree.root)).not.toContain('Swipe, or tap');
  });
});
