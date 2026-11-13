/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Closing a month closes its books, as the admin sees it: the Expenses screen opens on this month, older months are one tap
 * away, an expense in a closed month shows a lock and offers no way to change it, the line above the list says how far the
 * books are closed, and a date in a closed month is refused before it is sent.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isLockedDate, lockNotice, monthOfDate } from '@/utils/expenseLock';
import { currentMonth, monthTitle, shiftMonth } from '@/reports/residentReports';

const mockGet = jest.fn();
let mockLockedThrough: { year: number; month: number } | null = null;

const row = (id: string, description: string, status: string, locked: boolean) => ({
  id, category: { name: 'REPAIRS' }, description, amount: '1000', expenseDate: '2026-09-02T00:00:00.000Z',
  status, vendorPayee: null, notes: null, createdAt: '2026-09-02', locked,
});

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
  },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: { list: jest.fn().mockResolvedValue([{ id: 'acc-1', name: 'Main Account', currentBalance: '100000' }]) },
  fundsApi: { list: jest.fn().mockResolvedValue([]) },
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
const byLabel = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => n.props.accessibilityLabel === label);
const trees: any[] = [];
async function mount(waitFor = 'Closed month repair') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ExpensesScreen /></QueryClientProvider>); });
  trees.push(tree);
  await until(() => textOf(tree.root).includes(waitFor));
  return tree;
}
const lastParams = () => (mockGet.mock.calls[mockGet.mock.calls.length - 1][1] as { params: Record<string, unknown> }).params;
const press = async (tree: any, label: string) => { await act(async () => { byLabel(tree, label)[0].props.onPress(); }); };

beforeEach(() => {
  mockLockedThrough = { year: 2026, month: 9 };
  mockGet.mockReset();
  mockGet.mockImplementation(async () => ({
    data: {
      data: [
        row('e-closed-pending', 'Closed month repair', 'PENDING', true),
        row('e-closed-approved', 'Closed month AMC', 'APPROVED', true),
        row('e-closed-paid', 'Closed month service', 'PAID', true),
        row('e-open-pending', 'Open month repair', 'PENDING', false),
        row('e-open-approved', 'Open month AMC', 'APPROVED', false),
      ],
      meta: { lockedThrough: mockLockedThrough },
    },
  }));
});
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });

describe('closed-month working-out', () => {
  it('puts a date in the month it falls in for the society, whatever time it carries', () => {
    expect(monthOfDate('2026-10-31')).toEqual({ year: 2026, month: 10 });
    expect(monthOfDate('2026-10-31T18:31:00Z')).toEqual({ year: 2026, month: 11 }); // just past midnight in India
    expect(monthOfDate('not a date')).toBeNull();
  });

  it('locks the closed month and every month before it, and nothing after', () => {
    const through = { year: 2026, month: 10 };
    expect(isLockedDate('2026-10-31', through)).toBe(true);
    expect(isLockedDate('2026-01-05', through)).toBe(true);
    expect(isLockedDate('2025-12-31', through)).toBe(true);
    expect(isLockedDate('2026-11-01', through)).toBe(false);
    expect(isLockedDate('2027-01-01', through)).toBe(false);
  });

  it('locks nothing when no month is closed, or the date is unreadable', () => {
    expect(isLockedDate('2020-01-01', null)).toBe(false);
    expect(isLockedDate('2020-01-01', undefined)).toBe(false);
    expect(isLockedDate('nonsense', { year: 2026, month: 10 })).toBe(false);
  });

  it('tells the admin how far the books are closed', () => {
    expect(lockNotice({ year: 2026, month: 10 })).toBe('Books are closed up to October 2026. Expenses up to then cannot be added or changed.');
    expect(lockNotice(null)).toBeNull();
  });
});

describe('Expenses screen — months', () => {
  it('opens on this month', async () => {
    const tree = await mount();
    const now = currentMonth();
    expect(lastParams()).toMatchObject({ year: now.year, month: now.month });
    expect(textOf(tree.root)).toContain(monthTitle(now));
  });

  it('steps back to an earlier month, and cannot go past this one', async () => {
    const tree = await mount();
    const next = byLabel(tree, 'Next month')[0];
    expect(next.props.disabled).toBe(true);
    await press(tree, 'Previous month');
    const prev = shiftMonth(currentMonth(), -1);
    await until(() => lastParams().month === prev.month && lastParams().year === prev.year);
    expect(textOf(tree.root)).toContain(monthTitle(prev));
  });

  it('shows every month on request, and comes back to this month', async () => {
    const tree = await mount();
    await press(tree, 'Show all months');
    await until(() => !('year' in lastParams()));
    expect(textOf(tree.root)).toContain('All months');
    expect('month' in lastParams()).toBe(false);
    await press(tree, 'Show this month');
    const now = currentMonth();
    await until(() => lastParams().year === now.year && lastParams().month === now.month);
  });

  it('keeps the status filter inside the month', async () => {
    const tree = await mount();
    await act(async () => {
      tree.root.findAll((n: any) => n.type === TouchableOpacity && textOf(n) === 'PAID')[0].props.onPress();
    });
    const now = currentMonth();
    await until(() => lastParams().status === 'PAID' && lastParams().month === now.month);
  });
});

describe('Expenses screen — a closed month', () => {
  it('says how far the books are closed', async () => {
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Books are closed up to September 2026');
  });

  it('says nothing when no month has been closed', async () => {
    mockLockedThrough = null;
    const tree = await mount();
    expect(textOf(tree.root)).not.toContain('Books are closed');
  });

  it('marks an expense in a closed month, and offers no way to approve, reject, edit, pay or correct it', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text.match(/Closed/g)?.length).toBeGreaterThanOrEqual(3); // three locked rows
    for (const label of ['Edit Closed month repair', 'Correct Closed month AMC', 'Correct Closed month service']) {
      expect(byLabel(tree, label)).toHaveLength(0);
    }
    // nothing on a locked row carries an action: the only Approve / Reject / Mark Paid / Edit / Correct are on the open ones
    const actionTexts = tree.root.findAll((n: any) => n.type === TouchableOpacity).map((n: any) => textOf(n));
    expect(actionTexts.filter((t: string) => t === 'Approve')).toHaveLength(1);
    expect(actionTexts.filter((t: string) => t === 'Reject')).toHaveLength(1);
    expect(actionTexts.filter((t: string) => t === 'Mark Paid')).toHaveLength(1);
  });

  it('still lets an open month be edited and corrected', async () => {
    const tree = await mount();
    expect(byLabel(tree, 'Edit Open month repair')).toHaveLength(1);
    expect(byLabel(tree, 'Correct Open month AMC')).toHaveLength(1);
  });

  it('refuses a date in a closed month in the add sheet, with the reason, before anything is sent', async () => {
    // Books closed through this month, so today's date, the sheet's default, is in a closed month.
    const now = currentMonth();
    mockLockedThrough = now;
    const tree = await mount();
    await press(tree, 'Add expense');
    await until(() => textOf(tree.root).includes('Add Expense'));
    expect(textOf(tree.root)).toContain(`${monthTitle(now)} and earlier months are closed. Choose a date after that.`);
  });

  it('shows no such message when the sheet\'s date is open', async () => {
    mockLockedThrough = shiftMonth(currentMonth(), -2); // closed two months ago; today is open
    const tree = await mount();
    await press(tree, 'Add expense');
    await until(() => textOf(tree.root).includes('Add Expense'));
    expect(textOf(tree.root)).not.toContain('earlier months are closed');
  });
});
