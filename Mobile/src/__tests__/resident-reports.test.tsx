/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident Reports screen: a resident's own statement is always there; the society-wide collection and expense views
 * appear only when the server says they are switched on; the month stepper never goes past this month; and the figures
 * on screen are the ones the server sent.
 */

import React from 'react';
import { TouchableOpacity, Share } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  currentMonth,
  isAfter,
  monthTitle,
  shiftMonth,
  statementRows,
  statementText,
  statementTotals,
} from '@/reports/residentReports';

const now = currentMonth();
let mockCollectionOn = true;
let mockExpensesOn = true;
let mockBills: any[] = [];
const mockCollectionCalls: Array<[number, number]> = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: { getMyBills: async () => ({ data: mockBills }) },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: {
    getCollectionReport: async (year: number, month: number) => {
      mockCollectionCalls.push([year, month]);
      if (!mockCollectionOn) return { enabled: false, year, month };
      // Only the current month has a published period; any other month has none.
      const cur = new Date();
      if (year !== cur.getFullYear() || month !== cur.getMonth() + 1) return { enabled: true, found: false, year, month };
      return { enabled: true, found: true, year, month, status: 'PUBLISHED', totalBilled: 71820, totalCollected: 31654, totalPending: 40166, collectionRate: 44.1, flatsBilled: 48, flatsPaid: 21 };
    },
    getExpenseReport: async (year: number, month: number) => {
      if (!mockExpensesOn) return { enabled: false, year, month };
      return { enabled: true, year, month, total: 11000, count: 3, byCategory: [{ category: 'Lift repairs', total: 5000 }, { category: 'Staff Salaries', total: 6000 }] };
    },
  },
}));

import ResidentReportsScreen from '../../app/(app)/resident/reports';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const flat = (node: any) => textOf(node).replace(/\s*\|\s*/g, ' ');
const trees: any[] = [];
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ResidentReportsScreen /></QueryClientProvider>); });
  trees.push(tree);
  return tree;
}
const press = async (tree: any, label: string) => {
  const target = tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === label)[0]
    ?? tree.root.findAll((n: any) => n.type === TouchableOpacity && flat(n).includes(label))[0];
  expect(target).toBeDefined();
  await act(async () => { target.props.onPress(); });
};
const bill = (over: Record<string, unknown>) => ({
  id: 'b', invoiceNumber: 'INV-1', totalAmount: '3500', paidAmount: '0', pendingAmount: '3500', isPaid: false, isPublished: true,
  flatCode: 'A-101', billingPeriod: { id: 'p', periodYear: 2026, periodMonth: 10, kind: 'REGULAR' }, createdAt: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => {
  mockCollectionOn = true;
  mockExpensesOn = true;
  mockCollectionCalls.length = 0;
  mockBills = [
    bill({ id: 'b9', invoiceNumber: 'INV-9', totalAmount: '3500', paidAmount: '3500', pendingAmount: '0', isPaid: true, billingPeriod: { id: 'p9', periodYear: 2026, periodMonth: 9, kind: 'REGULAR' } }),
    bill({ id: 'b10', invoiceNumber: 'INV-10', totalAmount: '3500', paidAmount: '1000', pendingAmount: '2500' }),
    bill({ id: 'b11', invoiceNumber: 'INV-11', totalAmount: '3600', paidAmount: '0', pendingAmount: '3600', isPublished: false, billingPeriod: { id: 'p11', periodYear: 2026, periodMonth: 11, kind: 'REGULAR' } }),
  ];
});
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });

describe('statement working-out', () => {
  it('leaves out a bill still being prepared, puts the newest month first and adds up what is owed', () => {
    const rows = statementRows(mockBills as any);
    expect(rows.map((r) => r.title)).toEqual(['October 2026', 'September 2026']);
    expect(rows.map((r) => r.state)).toEqual(['PART', 'PAID']);
    expect(statementTotals(rows)).toEqual({ billed: 7000, paid: 4500, pending: 2500 });
  });

  it('labels an opening-balance bill as that, and a bill with no period by its invoice number', () => {
    const rows = statementRows([
      bill({ id: 'o', billingPeriod: { id: 'po', periodYear: 2026, periodMonth: 4, kind: 'OPENING' } }),
      bill({ id: 'n', invoiceNumber: 'INV-X', billingPeriod: undefined }),
    ] as any);
    expect(rows.map((r) => r.title).sort()).toEqual(['INV-X', 'Opening balance']);
  });

  it('writes the statement as text that can be shared', () => {
    const text = statementText(statementRows(mockBills as any), 'A-101');
    expect(text).toContain('Maintenance statement · A-101');
    expect(text).toContain('Billed ₹7,000 · Paid ₹4,500 · Pending ₹2,500');
    expect(text).toContain('October 2026: ₹3,500, paid ₹1,000, pending ₹2,500 (INV-10)');
    expect(text).toContain('September 2026: ₹3,500, paid ₹3,500 (INV-9)');
  });
});

describe('month stepper working-out', () => {
  it('steps back and forward across a year end, and knows what is after this month', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
    expect(isAfter({ year: 2026, month: 11 }, { year: 2026, month: 10 })).toBe(true);
    expect(isAfter({ year: 2026, month: 10 }, { year: 2026, month: 10 })).toBe(false);
    expect(monthTitle({ year: 2026, month: 3 })).toBe('March 2026');
  });
});

describe('Reports screen', () => {
  it('opens on the resident\'s own statement, with what they owe and a way to share it', async () => {
    const tree = await mount();
    await until(() => flat(tree.root).includes('STILL TO PAY'));
    const text = flat(tree.root);
    expect(text).toContain('₹2,500'); // still to pay
    expect(text).toContain('October 2026');
    expect(text).toContain('September 2026');
    expect(text).not.toContain('November 2026'); // unpublished bill
    expect(text).toContain('Share my statement');
  });

  it('shares the statement text', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' } as any);
    const tree = await mount();
    await until(() => flat(tree.root).includes('Share my statement'));
    await press(tree, 'Share my statement');
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0] as any).message).toContain('Pending ₹2,500');
    share.mockRestore();
  });

  it('offers the Collection and Expenses tabs when both are switched on', async () => {
    const tree = await mount();
    await until(() => ['My statement', 'Collection', 'Expenses'].every((l) => flat(tree.root).includes(l)));
  });

  it('shows only the statement, with no tabs at all, when neither society report is switched on', async () => {
    mockCollectionOn = false;
    mockExpensesOn = false;
    const tree = await mount();
    await until(() => flat(tree.root).includes('STILL TO PAY'));
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    const text = flat(tree.root);
    expect(text).not.toContain('Collection');
    expect(text).not.toContain('Expenses');
    expect(text).not.toContain('My statement'); // no tab bar when there is only one view
  });

  it('shows only the reports that are switched on', async () => {
    mockExpensesOn = false;
    const tree = await mount();
    await until(() => flat(tree.root).includes('Collection'));
    expect(flat(tree.root)).not.toContain('Expenses');
  });

  it('shows the month\'s collection figures from the server, and how many flats have paid', async () => {
    const tree = await mount();
    await until(() => flat(tree.root).includes('Collection'));
    await press(tree, 'Collection');
    await until(() => flat(tree.root).includes('COLLECTED'));
    const text = flat(tree.root);
    expect(text).toContain('₹31,654');
    expect(text).toContain('of ₹71,820 billed');
    expect(text).toContain('44%');
    expect(text).toContain('21 of 48 flats have paid in full');
    expect(text).toContain(monthTitle(now));
  });

  it('steps to an earlier month, says so when it has no figures, and cannot go past this month', async () => {
    const tree = await mount();
    await until(() => flat(tree.root).includes('Collection'));
    await press(tree, 'Collection');
    await until(() => flat(tree.root).includes('COLLECTED'));

    const next = tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === 'Next month')[0];
    expect(next.props.disabled).toBe(true); // already on this month

    await press(tree, 'Previous month');
    const prev = shiftMonth(now, -1);
    await until(() => flat(tree.root).includes(monthTitle(prev)) && flat(tree.root).includes('No figures for this month'));
    expect(mockCollectionCalls).toContainEqual([prev.year, prev.month]);

    const next2 = tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === 'Next month')[0];
    expect(next2.props.disabled).toBe(false);
    await press(tree, 'Next month');
    await until(() => flat(tree.root).includes('COLLECTED'));
  });

  it('shows the expense breakdown with staff pay as one line', async () => {
    const tree = await mount();
    await until(() => flat(tree.root).includes('Expenses'));
    await press(tree, 'Expenses');
    await until(() => flat(tree.root).includes('SPENT'));
    const text = flat(tree.root);
    expect(text).toContain('₹11,000');
    expect(text).toContain('Lift repairs');
    expect(text).toContain('Staff Salaries');
    expect(text).toContain('₹6,000');
  });
});
