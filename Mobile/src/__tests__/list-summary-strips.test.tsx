/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The figures at the top of the busy list screens, and the chips on their rows: payments (counts that are also the
 * filters), helpdesk (open, in progress, resolved) and billing (the newest period's three figures).
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPayments = jest.fn();
const mockHelpdesk = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/api/endpoints/payments.api', () => ({ paymentsApi: { getAllPayments: (...a: unknown[]) => mockPayments(...a) } }));
jest.mock('@/api/endpoints/helpdesk.api', () => ({ helpdeskApi: { list: (...a: unknown[]) => mockHelpdesk(...a) } }));
jest.mock('@/components/helpdesk/RequestThread', () => ({ RequestThread: () => null }));
jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    getBillingPeriods: async () => ({ data: [
      { id: 'p2', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY', dueDate: '2026-10-10', totalBilled: '30880.01', totalCollected: '6530.57', totalPending: '24349.44' },
      { id: 'p1', periodYear: 2026, periodMonth: 9, status: 'CLOSED', kind: 'MONTHLY', dueDate: '2026-09-10', totalBilled: '28000', totalCollected: '28000', totalPending: '0' },
    ] }),
    getPeriods: async () => ({ data: [
      { id: 'p2', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY', dueDate: '2026-10-10', totalBilled: '30880.01', totalCollected: '6530.57', totalPending: '24349.44' },
      { id: 'p1', periodYear: 2026, periodMonth: 9, status: 'CLOSED', kind: 'MONTHLY', dueDate: '2026-09-10', totalBilled: '28000', totalCollected: '28000', totalPending: '0' },
    ] }),
  },
}));

import AdminPaymentsScreen from '../../app/(app)/admin/payments/index';
import AdminHelpdeskScreen from '../../app/(app)/admin/helpdesk/index';

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
async function mount(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  trees.push(tree);
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });
const tap = async (tree: any, label: string) =>
  act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => n.props.accessibilityLabel?.startsWith(label)).props.onPress(); });

describe('payment approvals', () => {
  const total: Record<string, number> = { PENDING: 3, UNDER_REVIEW: 1, APPROVED: 12 };
  beforeEach(() => {
    mockPayments.mockReset();
    mockPayments.mockImplementation(async (q: any) => ({
      data: q.limit === 1 ? [] : [{ id: 'x1', flatId: 'f1', flat: { flatCode: 'A-101' }, user: { firstName: 'Asha', lastName: 'Rao' }, amount: '3500', status: q.status ?? 'PENDING', paymentMethod: 'UPI', createdAt: '2026-10-08T10:00:00Z' }],
      meta: { total: total[q.status] ?? 0 },
    }));
  });

  it('shows how many are waiting in each state, above the list', async () => {
    const tree = await mount(<AdminPaymentsScreen />);
    await until(() => textOf(tree.root).includes('Approved'));
    await until(() => ['To review', '3', 'Under review', '1', '12'].every((x) => textOf(tree.root).includes(x)));
    expect(textOf(tree.root)).toContain('Payment Approvals');
  });

  it('turns a count into the filter for that state', async () => {
    const tree = await mount(<AdminPaymentsScreen />);
    await until(() => textOf(tree.root).includes('Under review'));
    await tap(tree, 'Approved');
    await until(() => mockPayments.mock.calls.some((c) => c[0].status === 'APPROVED' && c[0].limit === 50));
  });

  it('puts a chip with the flat on each payment', async () => {
    const tree = await mount(<AdminPaymentsScreen />);
    await until(() => textOf(tree.root).includes('Asha Rao'));
    expect(textOf(tree.root)).toContain('A-'); // the chip: the first two characters of the flat code
    expect(textOf(tree.root)).toContain('₹3,500');
  });
});

describe('helpdesk', () => {
  beforeEach(() => {
    mockHelpdesk.mockReset();
    mockHelpdesk.mockImplementation(async (q: any) => {
      const all = [
        { id: 'r1', title: 'Lift stuck', status: 'OPEN', priority: 'HIGH', category: 'LIFT', createdAt: '2026-10-01', flat: { unitNumber: '101' } },
        { id: 'r2', title: 'Leak', status: 'OPEN', priority: 'MEDIUM', category: 'PLUMBING', createdAt: '2026-10-02' },
        { id: 'r3', title: 'Light out', status: 'IN_PROGRESS', priority: 'LOW', category: 'ELECTRICAL', createdAt: '2026-10-03' },
        { id: 'r4', title: 'Gate paint', status: 'RESOLVED', priority: 'LOW', category: 'OTHER', createdAt: '2026-10-04' },
      ];
      return { data: q.status ? all.filter((r) => r.status === q.status) : all, meta: {} };
    });
  });

  it('counts open, in progress and resolved requests across all of them', async () => {
    const tree = await mount(<AdminHelpdeskScreen />);
    await until(() => ['Open', 'In progress', 'Resolved'].every((x) => textOf(tree.root).includes(x)));
    const text = textOf(tree.root);
    expect(text).toContain('Lift stuck');
    // Open 2, in progress 1, resolved 1: in that order, one tile after another.
    expect(text.replace(/\s*\|\s*/g, ' ')).toMatch(/Open 2.*In progress 1.*Resolved 1/s);
  });

  it('keeps the counts whole when the list is filtered, and filters by tapping a count', async () => {
    const tree = await mount(<AdminHelpdeskScreen />);
    await until(() => textOf(tree.root).includes('Resolved'));
    await tap(tree, 'Resolved');
    await until(() => mockHelpdesk.mock.calls.some((c) => c[0].status === 'RESOLVED'));
    await until(() => textOf(tree.root).includes('Gate paint') && !textOf(tree.root).includes('Lift stuck'));
    expect(textOf(tree.root).replace(/\s*\|\s*/g, ' ')).toMatch(/Open 2.*In progress 1.*Resolved 1/s); // not 0, 0, 1
  });
});
