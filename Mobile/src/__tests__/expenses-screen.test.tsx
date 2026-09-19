/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tapping "Mark Paid" on an approved expense must open the account sheet,
 * and confirming with an account must POST to mark-paid. Reported broken on
 * device ("nothing happens") — the sheets are now drawn in-tree rather than
 * as native Modals, and this pins that they open and submit.
 */

import React from 'react';
import { Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn().mockResolvedValue({ data: {} });
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      data: {
        data: [
          {
            id: 'exp-1', categoryName: 'MAINTENANCE', description: 'Lift repair', amount: '2500',
            expenseDate: '2026-09-09', status: 'APPROVED', payeeName: null, notes: null,
            createdAt: '2026-09-09',
          },
        ],
        meta: {},
      },
    }),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: {
    list: jest.fn().mockResolvedValue([
      { id: 'acc-1', name: 'Main Account', currentBalance: '100000' },
    ]),
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import ExpensesScreen from '../../app/(app)/admin/expenses/index';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function textOf(node: any): string {
  return node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
    .map((n: any) => n.children.join('')).join(' | ');
}

jest.useRealTimers();

describe('Expenses screen — Mark Paid', () => {
  beforeEach(() => { mockPost.mockClear(); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });

  it('opens the account sheet when Mark Paid is tapped, and submits the chosen account', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let tree!: any;
    await act(async () => {
      tree = TestRenderer.create(
        <QueryClientProvider client={qc}><ExpensesScreen /></QueryClientProvider>,
      );
    });
    await flush();
    await flush();

    // Sheet is not on screen until asked for.
    expect(textOf(tree.root)).not.toContain('Pay from account');

    // The card's Mark Paid action.
    const cardBtn = tree.root.findAll(
      (n: any) => typeof n.props.onPress === 'function' && textOf(n) === 'Mark Paid',
    )[0];
    expect(cardBtn).toBeDefined();
    await act(async () => { cardBtn.props.onPress(); });

    expect(textOf(tree.root)).toContain('Pay from account');
    expect(textOf(tree.root)).toContain('Main Account');

    // Only one account exists, so it is preselected: confirming submits it.
    const confirmBtns = tree.root.findAll(
      (n: any) => typeof n.props.onPress === 'function' && textOf(n) === 'Mark Paid',
    );
    const confirm = confirmBtns[confirmBtns.length - 1];
    await act(async () => { confirm.props.onPress(); });
    await flush();

    expect(mockPost).toHaveBeenCalledWith('/expenses/exp-1/mark-paid', { accountId: 'acc-1' });
  });
});
