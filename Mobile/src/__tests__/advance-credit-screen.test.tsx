/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Advance Credit screen, rendered: the flats that hold an advance, and refunding one — only for the
 * admin, only up to what the flat holds and the account has, and only after asking.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = jest.fn();
const mockRefund = jest.fn();
let mockIsAdmin = true;

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    listAdvanceCredits: (...a: unknown[]) => mockList(...a),
    refundAdvance: (...a: unknown[]) => mockRefund(...a),
  },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: {
    list: jest.fn(async () => [
      { id: 'acc-main', name: 'Main account', currentBalance: '50000', isActive: true },
      { id: 'acc-cash', name: 'Cash box', currentBalance: '200', isActive: true },
    ]),
  },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import AdvanceCreditScreen from '../../app/(app)/admin/advance-credit/index';

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
/** The sheet's own Refund button: the ones on the list carry an accessibility label naming the flat. */
const sheetRefund = (tree: any) => byText(tree, 'Refund').filter((n: any) => !n.props.accessibilityLabel)[0];
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><AdvanceCreditScreen /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('Held in advance'));
  return tree;
}

beforeEach(() => {
  mockIsAdmin = true;
  mockList.mockReset().mockResolvedValue({
    total: '2300',
    flats: [
      { flatId: 'f1', flatCode: 'A-101', residentName: 'Arjun Mehta', balance: '1800' },
      { flatId: 'f2', flatCode: 'B-201', residentName: null, balance: '500' },
    ],
  });
  mockRefund.mockReset().mockResolvedValue({ flatCode: 'A-101', refunded: '800', remaining: '1000' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Advance Credit screen', () => {
  it('lists the flats that hold an advance and the total', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('₹2,300');
    expect(text).toContain('A-101');
    expect(text).toContain('Arjun Mehta');
    expect(text).toContain('₹1,800');
    expect(text).toContain('No resident');
  });

  it('refunds only after asking, with the account and the reason', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Refund the advance of A-101')[0].props.onPress(); });
    await until(() => !!input(tree, 'Refund amount'));

    expect(sheetRefund(tree).props.disabled).toBe(true); // nothing entered yet
    await act(async () => { input(tree, 'Refund amount').props.onChangeText('800'); });
    await until(() => byLabel(tree, 'Pay from Main account').length === 1);
    await act(async () => { byLabel(tree, 'Pay from Main account')[0].props.onPress(); });
    await act(async () => { input(tree, 'Reason').props.onChangeText('Resident asked for it back'); });
    await act(async () => { input(tree, 'Reference').props.onChangeText('UTR123'); });
    expect(sheetRefund(tree).props.disabled).toBe(false);

    await act(async () => { sheetRefund(tree).props.onPress(); });
    expect(mockRefund).not.toHaveBeenCalled(); // it asks first
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Refund advance');
    expect(ask[1]).toContain('₹800');
    expect(ask[1]).toContain('Main account');
    await act(async () => { ask[2].find((b: any) => b.text === 'Refund').onPress(); });

    await until(() => mockRefund.mock.calls.length === 1);
    expect(mockRefund).toHaveBeenCalledWith({
      flatId: 'f1', amount: 800, accountId: 'acc-main', reason: 'Resident asked for it back', referenceNumber: 'UTR123',
    });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Refund recorded'));
  });

  it('will not refund more than the flat holds, or more than the account has', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Refund the advance of B-201')[0].props.onPress(); });
    await until(() => !!input(tree, 'Refund amount'));
    await until(() => byLabel(tree, 'Pay from Cash box').length === 1);
    await act(async () => { input(tree, 'Reason').props.onChangeText('Moving out'); });

    await act(async () => { input(tree, 'Refund amount').props.onChangeText('600'); });
    await act(async () => { byLabel(tree, 'Pay from Main account')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('The flat holds only ₹500.');
    expect(sheetRefund(tree).props.disabled).toBe(true);

    await act(async () => { input(tree, 'Refund amount').props.onChangeText('500'); });
    await act(async () => { byLabel(tree, 'Pay from Cash box')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('Cash box holds only ₹200.');
    expect(sheetRefund(tree).props.disabled).toBe(true);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('can fill in the whole advance', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Refund the advance of B-201')[0].props.onPress(); });
    await until(() => !!input(tree, 'Refund amount'));
    await act(async () => { byLabel(tree, 'Refund all of it')[0].props.onPress(); });
    expect(input(tree, 'Refund amount').props.value).toBe('500');
  });

  it('shows no refund to anyone but the admin', async () => {
    mockIsAdmin = false;
    const tree = await mount();
    expect(byLabel(tree, 'Refund the advance of A-101')).toHaveLength(0);
    expect(textOf(tree.root)).toContain('Only the admin can refund an advance.');
  });
});
