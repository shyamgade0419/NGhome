/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Choosing the fund an expense is spent from: on the Add Expense form, shown on the card until it is paid, the
 * starting choice in Mark Paid (still changeable, or clearable to "general money"), and sent exactly so.
 */

import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn();
let mockExpenses: any[] = [];

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { data: mockExpenses, meta: {} } })),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: { list: jest.fn().mockResolvedValue([{ id: 'acc-1', name: 'Main Account', currentBalance: '100000' }]) },
  fundsApi: {
    list: jest.fn().mockResolvedValue([
      { id: 'f1', name: 'Ganesh Fund', kind: 'OTHER', currentBalance: '23160' },
      { id: 'f2', name: 'Corpus Fund', kind: 'CORPUS', currentBalance: '250000' },
    ]),
  },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: ({ rightAction }: any) => rightAction ?? null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import ExpensesScreen from '../../app/(app)/admin/expenses/index';

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

const expense = (over: Record<string, unknown> = {}) => ({
  id: 'exp-1', categoryName: 'EVENTS', description: 'Ganesh idol', amount: '5000', expenseDate: '2026-10-01',
  status: 'APPROVED', payeeName: null, notes: null, createdAt: '2026-10-01', documents: [], ...over,
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><ExpensesScreen /></QueryClientProvider>);
  });
  await until(() => !textOf(tree.root).includes('Loading expenses'));
  return tree;
}

/** Tap the Mark Paid on the card, wait for the sheet, and return the button that confirms it. */
async function openMarkPaid(tree: any) {
  await act(async () => { byText(tree, 'Mark Paid')[0].props.onPress(); });
  await until(() => textOf(tree.root).includes('Pay from account'));
  const confirms = byText(tree, 'Mark Paid');
  return confirms[confirms.length - 1];
}

beforeEach(() => {
  mockExpenses = [];
  mockPost.mockReset().mockResolvedValue({ data: { data: { id: 'new-exp' } } });
  // spyOn hands back the same spy each time, so clear what an earlier test recorded: a test waiting for its own alert must not be satisfied by a previous one.
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => {});
});

describe('Expenses — the fund an expense is spent from', () => {
  it('says on the card which fund it is to be paid from, and which it was paid from', async () => {
    mockExpenses = [
      expense({ id: 'a', description: 'Ganesh idol', status: 'APPROVED', fund: { id: 'f1', name: 'Ganesh Fund' } }),
      expense({ id: 'b', description: 'Lift', status: 'PAID', fund: { id: 'f2', name: 'Corpus Fund' } }),
    ];
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('To be paid from Ganesh Fund');
    expect(text).toContain('Paid from Corpus Fund');
  });

  it('offers the funds on the Add Expense form and sends the one chosen', async () => {
    const tree = await mount();
    await act(async () => { pressables(tree)[0].props.onPress(); });
    await until(() => byLabel(tree, 'Spend from Ganesh Fund').length === 1);

    const inputs = tree.root.findAll((n: any) => n.props.placeholder === 'e.g. Plumber repair work' || n.props.placeholder === '0.00');
    await act(async () => { inputs.find((n: any) => n.props.placeholder === 'e.g. Plumber repair work').props.onChangeText('Ganesh idol'); });
    await act(async () => { inputs.find((n: any) => n.props.placeholder === '0.00').props.onChangeText('5000'); });
    await act(async () => { byLabel(tree, 'Spend from Ganesh Fund')[0].props.onPress(); });
    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });

    await until(() => mockPost.mock.calls.length === 1);
    expect(mockPost).toHaveBeenCalledWith('/expenses', expect.objectContaining({ description: 'Ganesh idol', amount: 5000, fundId: 'f1' }));
    // The confirmation alert is raised 400 ms after the sheet closes. Wait for it here, so that timer never outlives the test
    // and fires inside whichever test file this worker runs next (it did, and failed that one in CI).
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Added'));
  });

  it('sends no fund when none is chosen on the form', async () => {
    const tree = await mount();
    await act(async () => { pressables(tree)[0].props.onPress(); });
    await until(() => byLabel(tree, 'Spend from general money').length === 1);
    const inputs = tree.root.findAll((n: any) => n.props.placeholder === 'e.g. Plumber repair work' || n.props.placeholder === '0.00');
    await act(async () => { inputs.find((n: any) => n.props.placeholder === 'e.g. Plumber repair work').props.onChangeText('Tap washers'); });
    await act(async () => { inputs.find((n: any) => n.props.placeholder === '0.00').props.onChangeText('350'); });
    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });
    await until(() => mockPost.mock.calls.length === 1);
    expect(mockPost.mock.calls[0][1].fundId).toBeUndefined();
    // The confirmation alert is raised 400 ms after the sheet closes. Wait for it here, so that timer never outlives the test
    // and fires inside whichever test file this worker runs next (it did, and failed that one in CI).
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Added'));
  });

  it('starts Mark Paid on the fund it was posted against, and pays from it', async () => {
    mockExpenses = [expense({ fund: { id: 'f1', name: 'Ganesh Fund' } })];
    const tree = await mount();
    const confirm = await openMarkPaid(tree);
    await act(async () => { confirm.props.onPress(); });
    await until(() => mockPost.mock.calls.length === 1);
    expect(mockPost).toHaveBeenCalledWith('/expenses/exp-1/mark-paid', { accountId: 'acc-1', fundId: 'f1' });
  });

  it('lets the person paying choose another fund', async () => {
    mockExpenses = [expense({ fund: { id: 'f1', name: 'Ganesh Fund' } })];
    const tree = await mount();
    const confirm = await openMarkPaid(tree);
    await act(async () => { byLabel(tree, 'Pay out of Corpus Fund')[0].props.onPress(); });
    await act(async () => { confirm.props.onPress(); });
    await until(() => mockPost.mock.calls.length === 1);
    expect(mockPost.mock.calls[0][1]).toEqual({ accountId: 'acc-1', fundId: 'f2' });
  });

  it('sends null, not nothing, when the fund is cleared, so it is paid from the general money', async () => {
    mockExpenses = [expense({ fund: { id: 'f1', name: 'Ganesh Fund' } })];
    const tree = await mount();
    const confirm = await openMarkPaid(tree);
    await act(async () => { byLabel(tree, 'Pay out of general money')[0].props.onPress(); });
    await act(async () => { confirm.props.onPress(); });
    await until(() => mockPost.mock.calls.length === 1);
    expect(mockPost.mock.calls[0][1]).toEqual({ accountId: 'acc-1', fundId: null });
  });
});
