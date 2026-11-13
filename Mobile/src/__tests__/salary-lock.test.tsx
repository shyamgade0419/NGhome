/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Closing a month closes its salaries too, as the admin sees it on the Salaries screen: a salary for a closed month shows a
 * lock and offers no Mark as Paid, the line above the list says how far the books are closed, and an open month still has
 * its button.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isLockedMonth, lockNotice } from '@/utils/expenseLock';

let mockLockedThrough: { year: number; month: number } | null = null;

const record = (id: string, name: string, locked: boolean) => ({
  id, employeeId: `emp-${id}`, salaryMonth: new Date().getMonth() + 1, salaryYear: new Date().getFullYear(),
  baseSalary: '12000', additions: '0', deductions: '0', netSalary: '12000', status: 'PROCESSED', paymentDate: null, notes: null,
  employee: { name, designation: 'Security' }, locked,
});

jest.mock('@/api/endpoints/salaries.api', () => ({
  salariesApi: {
    listEmployees: async () => [],
    listRecords: async () => ({ data: [record('a', 'Closed Watchman', true), record('b', 'Open Gardener', false)], meta: {} }),
    pay: jest.fn().mockResolvedValue({}),
    lockedThrough: async () => mockLockedThrough,
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import SalariesScreen from '../../app/(app)/admin/salaries/index';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const trees: any[] = [];
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><SalariesScreen /></QueryClientProvider>); });
  trees.push(tree);
  const records = tree.root.findAll((n: any) => n.type === TouchableOpacity && textOf(n) === 'Records')[0];
  if (records) await act(async () => { records.props.onPress(); });
  await until(() => textOf(tree.root).includes('Open Gardener'));
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });

describe('closed-month working-out for a salary', () => {
  it('locks the closed month and every month before it, across years, and nothing after', () => {
    const through = { year: 2026, month: 10 };
    expect(isLockedMonth(2026, 10, through)).toBe(true);
    expect(isLockedMonth(2026, 4, through)).toBe(true);
    expect(isLockedMonth(2025, 12, through)).toBe(true);
    expect(isLockedMonth(2026, 11, through)).toBe(false);
    expect(isLockedMonth(2027, 1, through)).toBe(false);
  });
  it('locks nothing when no month is closed', () => {
    expect(isLockedMonth(2020, 1, null)).toBe(false);
    expect(isLockedMonth(2020, 1, undefined)).toBe(false);
  });
  it('words the notice for salaries, and for expenses as before', () => {
    expect(lockNotice({ year: 2026, month: 10 }, 'salary')).toBe('Books are closed up to October 2026. Salaries for then or earlier months cannot be processed or paid.');
    expect(lockNotice({ year: 2026, month: 10 })).toBe('Books are closed up to October 2026. Expenses up to then cannot be added or changed.');
    expect(lockNotice(null, 'salary')).toBeNull();
  });
});

describe('Salaries screen — a closed month', () => {
  beforeEach(() => { mockLockedThrough = { year: 2026, month: 9 }; });

  it('says how far the books are closed', async () => {
    const tree = await mount();
    await until(() => textOf(tree.root).includes('Books are closed up to September 2026'));
    expect(textOf(tree.root)).toContain('Salaries for then or earlier months cannot be processed or paid.');
  });

  it('marks a closed salary and offers no Mark as Paid on it, while an open one keeps its button', async () => {
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Closed');
    const payButtons = tree.root.findAll((n: any) => n.type === TouchableOpacity && textOf(n) === 'Mark as Paid');
    expect(payButtons).toHaveLength(1); // only the open one
  });

  it('says nothing about closing when no month is closed', async () => {
    mockLockedThrough = null;
    const tree = await mount();
    expect(textOf(tree.root)).not.toContain('Books are closed');
  });
});
