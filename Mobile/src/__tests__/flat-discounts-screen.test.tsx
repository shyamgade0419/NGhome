/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Flat Discounts screen, rendered: the standing discounts and whether each is in force, switching one
 * off, removing one after asking, and adding one — with what is sent.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    listFlatDiscounts: (...a: unknown[]) => mockList(...a),
    createFlatDiscount: (...a: unknown[]) => mockCreate(...a),
    updateFlatDiscount: (...a: unknown[]) => mockUpdate(...a),
    deleteFlatDiscount: (...a: unknown[]) => mockDelete(...a),
  },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: { getFlats: jest.fn(async () => ({ data: [{ id: 'f1', flatCode: 'A-101' }, { id: 'f2', flatCode: 'B-201' }] })) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: ({ rightAction }: any) => rightAction ?? null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import FlatDiscountsScreen from '../../app/(app)/admin/flat-discounts/index';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const pressables = (tree: any) => tree.root.findAllByType(TouchableOpacity);
const byLabel = (tree: any, label: string) => pressables(tree).filter((n: any) => n.props.accessibilityLabel === label);
const byText = (tree: any, label: string) => pressables(tree).filter((n: any) => textOf(n) === label);
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);

const discount = (over: Record<string, unknown> = {}) => ({
  id: 'd1', flatId: 'f1', flatCode: 'A-101', residentName: 'Arjun Mehta', type: 'FIXED', value: '500', reason: 'Senior citizen',
  effectiveFrom: '2026-04-01T00:00:00.000Z', effectiveTo: null, isActive: true, status: 'ACTIVE', ...over,
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><FlatDiscountsScreen /></QueryClientProvider>);
  });
  await until(() => !textOf(tree.root).includes('Loading discounts'));
  return tree;
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([discount(), discount({ id: 'd2', flatCode: 'B-201', type: 'PERCENT', value: '10', reason: 'Founder', status: 'OFF', isActive: false, effectiveTo: '2027-03-31T00:00:00.000Z' })]);
  mockCreate.mockReset().mockResolvedValue({});
  mockUpdate.mockReset().mockResolvedValue({});
  mockDelete.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Flat Discounts screen', () => {
  it('lists each discount with what it takes off, why, and whether it is in force', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('A-101 · Arjun Mehta');
    expect(text).toContain('₹500 off');
    expect(text).toContain('Senior citizen');
    expect(text).toContain('In force');
    expect(text).toContain('10% off');
    expect(text).toContain('Switched off');
    expect(text).toContain('no end');
  });

  it('switches a discount off and on', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Switch off the discount for A-101')[0].props.onPress(); });
    await until(() => mockUpdate.mock.calls.length === 1);
    expect(mockUpdate).toHaveBeenCalledWith('d1', { isActive: false });
    await act(async () => { byLabel(tree, 'Switch on the discount for B-201')[0].props.onPress(); });
    await until(() => mockUpdate.mock.calls.length === 2);
    expect(mockUpdate).toHaveBeenLastCalledWith('d2', { isActive: true });
  });

  it('removes a discount only after asking', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Remove the discount for A-101')[0].props.onPress(); });
    expect(mockDelete).not.toHaveBeenCalled();
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Remove discount');
    expect(ask[1]).toContain('₹500 off');
    await act(async () => { ask[2].find((b: any) => b.text === 'Remove').onPress(); });
    await until(() => mockDelete.mock.calls.length === 1);
    expect(mockDelete).toHaveBeenCalledWith('d1');
  });

  it('adds a discount for a flat, for a range of months, and sends the first and last day', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Add a flat discount')[0].props.onPress(); });
    await until(() => !!input(tree, 'Find a flat'));

    expect(byText(tree, 'Add discount')[0].props.disabled).toBe(true); // nothing chosen yet
    await act(async () => { input(tree, 'Find a flat').props.onChangeText('b-2'); });
    await until(() => byLabel(tree, 'Choose B-201').length === 1);
    await act(async () => { byLabel(tree, 'Choose B-201')[0].props.onPress(); });
    await act(async () => { input(tree, 'Discount value').props.onChangeText('750'); });
    await act(async () => { input(tree, 'Reason').props.onChangeText('Committee concession'); });
    await act(async () => { input(tree, 'From month').props.onChangeText('2026-04'); });
    await act(async () => { input(tree, 'Until month').props.onChangeText('2027-03'); });
    expect(byText(tree, 'Add discount')[0].props.disabled).toBe(false);

    await act(async () => { byText(tree, 'Add discount')[0].props.onPress(); });
    await until(() => mockCreate.mock.calls.length === 1);
    expect(mockCreate).toHaveBeenCalledWith({
      flatId: 'f2', type: 'FIXED', value: 750, reason: 'Committee concession', effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31',
    });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Added'));
  });

  it('will not add a percentage over 100, an end before the start, or a bad month', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Add a flat discount')[0].props.onPress(); });
    await until(() => !!input(tree, 'Find a flat'));
    await until(() => byLabel(tree, 'Choose A-101').length === 1);
    await act(async () => { byLabel(tree, 'Choose A-101')[0].props.onPress(); });
    await act(async () => { byLabel(tree, 'Percentage')[0].props.onPress(); });
    await act(async () => { input(tree, 'Reason').props.onChangeText('Too generous'); });

    await act(async () => { input(tree, 'Discount value').props.onChangeText('150'); });
    expect(textOf(tree.root)).toContain('A percentage cannot be more than 100.');
    expect(byText(tree, 'Add discount')[0].props.disabled).toBe(true);

    await act(async () => { input(tree, 'Discount value').props.onChangeText('10'); });
    await act(async () => { input(tree, 'From month').props.onChangeText('2026-06'); });
    await act(async () => { input(tree, 'Until month').props.onChangeText('2026-05'); });
    expect(textOf(tree.root)).toContain('It cannot end before it starts.');

    await act(async () => { input(tree, 'Until month').props.onChangeText('soon'); });
    expect(textOf(tree.root)).toContain('Enter the last month');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
