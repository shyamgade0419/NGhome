/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Raising and lowering a fund by hand with a comment, the fund history, and correcting a bank balance from the
 * account sheet: what is previewed, what is sent, what is refused before sending, and who is offered what.
 */

import React from 'react';
import { Alert, Switch, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockIsAdmin = true;
const mockFundAdjust = jest.fn();
const mockAccountAdjust = jest.fn();

jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: {
    list: jest.fn(async () => [{ id: 'a1', name: 'Main', accountType: 'CURRENT', bankName: 'AXIS', currentBalance: '252265.09' }]),
    transactions: jest.fn(async () => ({ data: [] })),
    adjust: (...a: unknown[]) => mockAccountAdjust(...a),
    remove: jest.fn(),
  },
  fundsApi: {
    list: jest.fn(async () => [
      { id: 'c', name: 'Corpus fund', kind: 'CORPUS', currentBalance: '257765', openingBalance: '257765', description: null, isVisibleToResidents: false },
    ]),
    summary: jest.fn(async () => ({
      bankTotal: '252265.09', accounts: [], corpus: { total: '257765.00', funds: [{ id: 'c', name: 'Corpus fund', balance: '257765.00' }] },
      other: { total: '0.00', funds: [] }, fundsTotal: '257765.00', generalBalance: '-5499.91', fundsExceedBank: true, adds: false,
    })),
    adjust: (...a: unknown[]) => mockFundAdjust(...a),
    history: jest.fn(async () => ({
      fund: { id: 'c', name: 'Corpus fund', openingBalance: '257765.00', currentBalance: '250000.00' },
      entries: [
        { id: 'e2', date: '2026-11-01T00:00:00Z', direction: 'OUT', amount: '7765.00', description: 'Taken from Corpus fund: Entered too high', movedBankAccount: false, by: 'Demo Admin' },
        { id: 'e1', date: '2026-10-20T00:00:00Z', direction: 'IN', amount: '1000.00', description: 'Added to Corpus fund: Donation', movedBankAccount: true, by: null },
      ],
    })),
    create: jest.fn(),
    contribute: jest.fn(),
  },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import AccountsScreen from '../../app/(app)/admin/accounts/index';

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

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><AccountsScreen /></QueryClientProvider>);
  });
  await until(() => byText(tree, 'Funds').length > 0);
  return tree;
}
async function openFundSheet() {
  const tree = await mount();
  await act(async () => { byText(tree, 'Funds')[0].props.onPress(); });
  await until(() => byLabel(tree, 'Add or remove money for Corpus fund').length === 1);
  await act(async () => { byLabel(tree, 'Add or remove money for Corpus fund')[0].props.onPress(); });
  await until(() => input(tree, 'Amount') !== undefined);
  return tree;
}
const fill = async (tree: any, amount: string, comment: string) => {
  await act(async () => { input(tree, 'Amount').props.onChangeText(amount); });
  await act(async () => { input(tree, 'Comment').props.onChangeText(comment); });
};
const submit = async (tree: any, label: string) => { await act(async () => { byText(tree, label)[0].props.onPress(); }); };

beforeEach(() => {
  mockIsAdmin = true;
  mockFundAdjust.mockReset().mockResolvedValue({});
  mockAccountAdjust.mockReset().mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Funds — add or remove money', () => {
  it('says how far the funds are over the bank, and how to put it right', async () => {
    const tree = await mount();
    await act(async () => { byText(tree, 'Funds')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Funds are more than the bank'));
    const text = textOf(tree.root);
    expect(text).toContain('₹5,499.91 more than the bank holds');
    expect(text).toContain('Adjust balance');
  });

  it('removes money with a comment, after previewing what it does to the general money', async () => {
    const tree = await openFundSheet();
    await act(async () => { byLabel(tree, 'Remove money')[0].props.onPress(); });
    await fill(tree, '5499.91', 'Entered too high at set-up');

    const text = textOf(tree.root);
    expect(text).toContain('Corpus fund goes from ₹2,57,765.00 to ₹2,52,265.09');
    expect(text).toContain('from ₹-5,499.91 to ₹0.00');

    await submit(tree, 'Take from fund');
    await until(() => mockFundAdjust.mock.calls.length === 1);
    expect(mockFundAdjust).toHaveBeenCalledWith('c', { direction: 'DECREASE', amount: 5499.91, comment: 'Entered too high at set-up', accountId: undefined });
  });

  it('adds money and moves a bank account along with it when asked', async () => {
    const tree = await openFundSheet();
    await fill(tree, '1000', 'Cash donation banked');
    await act(async () => {
      tree.root.findAllByType(Switch).find((n: any) => n.props.accessibilityLabel === 'Also move a bank account').props.onValueChange(true);
    });
    await act(async () => { byText(tree, 'Main')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('The bank account goes up by the same');

    await submit(tree, 'Add to fund');
    await until(() => mockFundAdjust.mock.calls.length === 1);
    expect(mockFundAdjust).toHaveBeenCalledWith('c', { direction: 'INCREASE', amount: 1000, comment: 'Cash donation banked', accountId: 'a1' });
  });

  it('refuses before sending: no comment, no amount, or more than the fund holds', async () => {
    const tree = await openFundSheet();
    await fill(tree, '100', '');
    await submit(tree, 'Add to fund');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/comment/);

    await fill(tree, '', 'Some reason');
    await submit(tree, 'Add to fund');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/amount greater than zero/);

    await act(async () => { byLabel(tree, 'Remove money')[0].props.onPress(); });
    await fill(tree, '999999', 'Too much');
    await submit(tree, 'Take from fund');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/cannot be taken out/);

    expect(mockFundAdjust).not.toHaveBeenCalled();
  });

  it('shows the server reason when it refuses', async () => {
    mockFundAdjust.mockRejectedValue({ response: { data: { message: 'Corpus fund holds only ₹10.00.' } } });
    const tree = await openFundSheet();
    await fill(tree, '5', 'Small');
    await submit(tree, 'Add to fund');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Error')[1]).toContain('holds only');
  });

  it('leaves taking money out to the admin', async () => {
    mockIsAdmin = false;
    const tree = await openFundSheet();
    await act(async () => { byLabel(tree, 'Remove money')[0].props.onPress(); });
    expect((Alert.alert as jest.Mock).mock.calls.pop()[0]).toBe('Admin only');
    await fill(tree, '100', 'Donation');
    await submit(tree, 'Add to fund'); // still adding
    await until(() => mockFundAdjust.mock.calls.length === 1);
    expect(mockFundAdjust.mock.calls[0][1].direction).toBe('INCREASE');
  });
});

describe('Funds — history', () => {
  it('lists each entry with its comment, who made it, and whether the bank moved', async () => {
    const tree = await mount();
    await act(async () => { byText(tree, 'Funds')[0].props.onPress(); });
    await until(() => byLabel(tree, 'History of Corpus fund').length === 1);
    await act(async () => { byLabel(tree, 'History of Corpus fund')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Entered too high'));
    const text = textOf(tree.root);
    expect(text).toContain('Opened with ₹2,57,765.00');
    expect(text).toContain('−₹7,765.00');
    expect(text).toContain('Demo Admin');
    expect(text).toContain('+₹1,000.00');
    expect(text).toContain('bank account moved too');
  });
});

describe('Bank account — adjust the balance', () => {
  async function openAccountAdjust() {
    const tree = await mount();
    await until(() => textOf(tree.root).includes('Main'));
    const row = pressables(tree).find((n: any) => textOf(n).includes('AXIS'));
    await act(async () => { row.props.onPress(); });
    await until(() => byLabel(tree, 'Adjust balance').length === 1);
    await act(async () => { byLabel(tree, 'Adjust balance')[0].props.onPress(); });
    await until(() => input(tree, 'Amount') !== undefined);
    return tree;
  }

  it('corrects the balance with a comment, previewing the effect on the general money', async () => {
    const tree = await openAccountAdjust();
    await fill(tree, '5499.91', 'Interest credited by the bank');
    expect(textOf(tree.root)).toContain('The funds do not change');
    await submit(tree, 'Save balance');
    await until(() => mockAccountAdjust.mock.calls.length === 1);
    expect(mockAccountAdjust).toHaveBeenCalledWith('a1', { direction: 'INCREASE', amount: 5499.91, comment: 'Interest credited by the bank' });
  });

  it('is not offered to anyone but the admin', async () => {
    mockIsAdmin = false;
    const tree = await mount();
    await until(() => textOf(tree.root).includes('Main'));
    const row = pressables(tree).find((n: any) => textOf(n).includes('AXIS'));
    await act(async () => { row.props.onPress(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(byLabel(tree, 'Adjust balance')).toHaveLength(0);
  });
});
