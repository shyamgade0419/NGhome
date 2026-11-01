/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Water Readings screen: the usage limit (a flat pays the normal rate up to a limit, the units above it
 * cost more) is filled in from the saved rules, previews what it adds, is sent with the readings, and can be
 * switched off.
 */

import React from 'react';
import { Alert, Switch, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAllocate = jest.fn();
const mockConfigs = jest.fn();

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    getBillingPeriods: jest.fn(async () => ({
      data: [{ id: 'p1', status: 'DRAFT', periodMonth: 3, periodYear: 2026, kind: 'REGULAR' }],
    })),
  },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: {
    getFlats: jest.fn(async () => ({
      data: [
        { id: 'f1', flatCode: 'A-1', waterMeterReversed: false },
        { id: 'f2', flatCode: 'A-2', waterMeterReversed: false },
      ],
    })),
  },
}));
jest.mock('@/api/endpoints/water.api', () => ({
  waterApi: {
    getReadings: jest.fn(async () => []),
    listConfigs: (...a: unknown[]) => mockConfigs(...a),
    allocatePeriodCosts: (...a: unknown[]) => mockAllocate(...a),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import WaterReadingsScreen from '../../app/(app)/admin/water/index';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);
const limitSwitch = (tree: any) => tree.root.findAllByType(Switch).find((n: any) => n.props.accessibilityLabel === 'Charge more for heavy use');
const chip = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).find((n: any) => n.props.accessibilityLabel === label);

const saved = { limitUnits: 20, mode: 'PERCENT', value: 25 };

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><WaterReadingsScreen /></QueryClientProvider>);
  });
  await until(() => !!input(tree, 'Current reading for A-1'));
  return tree;
}

/** Enter readings: A-1 uses 10 KL, A-2 uses 30 KL, over a ₹4,000 bill (40 KL, so the normal rate is ₹100 a KL). */
async function enterReadings(tree: any) {
  await act(async () => { input(tree, 'Opening reading for A-1').props.onChangeText('100'); });
  await act(async () => { input(tree, 'Current reading for A-1').props.onChangeText('110'); });
  await act(async () => { input(tree, 'Opening reading for A-2').props.onChangeText('200'); });
  await act(async () => { input(tree, 'Current reading for A-2').props.onChangeText('230'); });
  await act(async () => { input(tree, 'Municipal Water Bill').props.onChangeText('4000'); });
  await act(async () => { input(tree, 'Electricity for Water').props.onChangeText('0'); });
}

async function save(tree: any) {
  const buttons = tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === 'Save Readings' || /Saving/.test(textOf(n)));
  await act(async () => { buttons[0].props.onPress(); });
  const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Save Water Readings');
  await act(async () => { ask[2].find((b: any) => b.text === 'Save').onPress(); });
}

beforeEach(() => {
  mockConfigs.mockReset().mockResolvedValue([{ id: 'c1', billingModel: 'SOCIETY_ALLOCATION', config: { usageLimit: saved } }]);
  mockAllocate.mockReset().mockResolvedValue({
    ratePerUnit: 100, flatReadings: [{ flatId: 'f2', excessUnits: 10 }, { flatId: 'f1', excessUnits: 0 }], usageLimit: saved, excessTotal: 250,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Water Readings — usage limit', () => {
  it('starts from the saved rule, switched on and filled in', async () => {
    const tree = await mount();
    await until(() => limitSwitch(tree).props.value === true);
    expect(input(tree, 'Limit per flat').props.value).toBe('20');
    expect(input(tree, 'Extra').props.value).toBe('25');
  });

  it('starts switched off when the society has no limit yet', async () => {
    mockConfigs.mockResolvedValue([{ id: 'c1', billingModel: 'SOCIETY_ALLOCATION', config: {} }]);
    const tree = await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(limitSwitch(tree).props.value).toBe(false);
    expect(input(tree, 'Limit per flat')).toBeUndefined();
  });

  it('says what the limit does and how much it adds, from the readings entered', async () => {
    const tree = await mount();
    await until(() => limitSwitch(tree).props.value === true);
    await enterReadings(tree);
    const text = textOf(tree.root);
    expect(text).toContain("Each flat's first 20 KL are charged at the normal rate");
    expect(text).toContain('₹100 becomes ₹125 a KL');
    expect(text).toContain('1 flat is above it, adding about ₹250');
  });

  it('sends the rule with the readings', async () => {
    const tree = await mount();
    await until(() => limitSwitch(tree).props.value === true);
    await enterReadings(tree);
    await act(async () => { chip(tree, 'Charge ₹ more per unit').props.onPress(); });
    await act(async () => { input(tree, 'Extra per KL').props.onChangeText('20'); });
    await save(tree);
    await until(() => mockAllocate.mock.calls.length === 1);
    expect(mockAllocate.mock.calls[0][0]).toBe('p1');
    expect(mockAllocate.mock.calls[0][1]).toMatchObject({
      municipalWaterBill: 4000,
      usageLimit: { limitUnits: 20, mode: 'PER_UNIT', value: 20 },
    });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Water Readings Saved ✓'));
    const saved = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Water Readings Saved ✓');
    expect(saved[1]).toContain('1 flat is above the 20 KL limit, adding ₹250');
  });

  it('sends null when the limit is switched off, so it is switched off for good', async () => {
    const tree = await mount();
    await until(() => limitSwitch(tree).props.value === true);
    await enterReadings(tree);
    await act(async () => { limitSwitch(tree).props.onValueChange(false); });
    await save(tree);
    await until(() => mockAllocate.mock.calls.length === 1);
    expect(mockAllocate.mock.calls[0][1].usageLimit).toBeNull();
  });

  it('will not save a limit that is not valid', async () => {
    const tree = await mount();
    await until(() => limitSwitch(tree).props.value === true);
    await enterReadings(tree);
    await act(async () => { input(tree, 'Limit per flat').props.onChangeText(''); });
    expect(textOf(tree.root)).toContain('Enter how many units a flat may use');
    const buttons = tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === 'Save Readings');
    await act(async () => { buttons[0].props.onPress(); });
    expect((Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Usage limit')).toBe(true);
    expect(mockAllocate).not.toHaveBeenCalled();
  });
});
