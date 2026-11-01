/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Correcting an expense from the phone: the admin gets Correct on an approved or paid expense, has to give a
 * comment, and sends only what changed; anyone can still edit a pending one; the history shows what was
 * changed and why.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPatch = jest.fn();
let mockIsAdmin = true;

const expenses = [
  {
    id: 'e-pending', category: { name: 'REPAIRS' }, description: 'Pump repair', amount: '900', expenseDate: '2026-09-01T00:00:00.000Z',
    status: 'PENDING', vendorPayee: null, notes: null, createdAt: '2026-09-01',
  },
  {
    id: 'e-approved', category: { name: 'UTILITIES' }, description: 'Lift AMC', amount: '4000', expenseDate: '2026-09-02T00:00:00.000Z',
    status: 'APPROVED', vendorPayee: 'Otis', notes: null, createdAt: '2026-09-02',
  },
  {
    id: 'e-paid', category: { name: 'REPAIRS' }, description: 'Generator service', amount: '2000', expenseDate: '2026-09-03T00:00:00.000Z',
    status: 'PAID', vendorPayee: 'Kumar Motors', notes: null, createdAt: '2026-09-03',
    account: { id: 'acc-1', name: 'Main Account' }, fund: null,
    correctedAt: '2026-09-10T00:00:00.000Z', correctionNote: 'Vendor billed 2000, not 1800',
  },
];

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url.endsWith('/history')) {
        return {
          data: {
            data: [{
              id: 'h1', at: '2026-09-10T10:00:00.000Z', by: 'Asha Admin', reason: 'Vendor billed 2000, not 1800',
              changes: { amount: { from: '1800.00', to: '2000.00' } }, accountBalanceAfter: '98000.00',
            }],
          },
        };
      }
      return { data: { data: expenses, meta: {} } };
    }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: { list: jest.fn().mockResolvedValue([{ id: 'acc-1', name: 'Main Account', currentBalance: '100000' }]) },
  fundsApi: { list: jest.fn().mockResolvedValue([]) },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
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
const byLabel = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => n.props.accessibilityLabel === label);
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><ExpensesScreen /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('Generator service'));
  return tree;
}

beforeEach(() => {
  mockIsAdmin = true;
  mockPatch.mockReset().mockResolvedValue({ data: { data: {} } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Expenses screen — correcting', () => {
  it('gives the admin Correct on approved and paid expenses, and Edit on a pending one', async () => {
    const tree = await mount();
    expect(byLabel(tree, 'Edit Pump repair')).toHaveLength(1);
    expect(byLabel(tree, 'Correct Lift AMC')).toHaveLength(1);
    expect(byLabel(tree, 'Correct Generator service')).toHaveLength(1);
  });

  it('shows anyone the latest correction note, but only the admin can correct a posted expense', async () => {
    mockIsAdmin = false;
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Corrected: Vendor billed 2000, not 1800');
    expect(byLabel(tree, 'Edit Pump repair')).toHaveLength(1); // a pending one is anyone's to fix
    expect(byLabel(tree, 'Correct Lift AMC')).toHaveLength(0);
    expect(byLabel(tree, 'Correct Generator service')).toHaveLength(0);
  });

  it('wants a comment for a paid expense, says what the account will do, and sends only what changed', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Correct Generator service')[0].props.onPress(); });
    await until(() => !!input(tree, 'Expense amount'));
    expect(textOf(tree.root)).toContain('already paid');

    await act(async () => { input(tree, 'Expense amount').props.onChangeText('2500'); });
    expect(textOf(tree.root)).toContain('Main Account goes down by ₹500.00');

    await act(async () => { byLabel(tree, 'Save correction')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('Add a comment saying why');
    expect(mockPatch).not.toHaveBeenCalled();

    await act(async () => { input(tree, 'Correction comment').props.onChangeText('Invoice was 2500'); });
    await act(async () => { byLabel(tree, 'Save correction')[0].props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/expenses/e-paid', { amount: 2500, reason: 'Invoice was 2500' });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Correction saved'));
  });

  it('refuses a save that changes nothing', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Correct Lift AMC')[0].props.onPress(); });
    await until(() => !!input(tree, 'Correction comment'));
    await act(async () => { input(tree, 'Correction comment').props.onChangeText('Just checking'); });
    await act(async () => { byLabel(tree, 'Save correction')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('Nothing has changed yet.');
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('needs no comment to fix a pending expense', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Edit Pump repair')[0].props.onPress(); });
    await until(() => !!input(tree, 'Expense description'));
    expect(textOf(tree.root)).not.toContain('already');
    await act(async () => { input(tree, 'Expense amount').props.onChangeText('950'); });
    await act(async () => { byLabel(tree, 'Save correction')[0].props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/expenses/e-pending', { amount: 950 });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Saved'));
  });

  it('shows the server\'s refusal on the sheet', async () => {
    mockPatch.mockRejectedValueOnce({ response: { data: { message: 'The fund this was paid from does not hold enough for the higher amount.' } } });
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Correct Generator service')[0].props.onPress(); });
    await until(() => !!input(tree, 'Expense amount'));
    await act(async () => { input(tree, 'Expense amount').props.onChangeText('9000'); });
    await act(async () => { input(tree, 'Correction comment').props.onChangeText('Bigger bill'); });
    await act(async () => { byLabel(tree, 'Save correction')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('does not hold enough'));
  });

  it('opens the history from the correction note', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Corrections to Generator service')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Amount: ₹1,800.00 → ₹2,000.00'));
    expect(textOf(tree.root)).toContain('Asha Admin');
    expect(textOf(tree.root)).toContain('Vendor billed 2000, not 1800');
  });
});
