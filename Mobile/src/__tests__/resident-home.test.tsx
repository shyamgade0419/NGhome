/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident home: the bill on the gradient hero card with how much of it is paid, tinted figure tiles, the swipe strip
 * (the bill that is due, notices, the next meeting and event) and the shortcut grid.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPush = jest.fn();
let mockBill: any;
let mockPreview: any;
let mockNotices: any[] = [];
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: { getMyCurrentBill: async () => mockBill, previewMyBill: async () => mockPreview },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: {
    getAnnouncements: async () => ({ data: mockNotices }),
    getMeetings: async () => ({ data: [
      { id: 'm0', title: 'Old meeting', meetingDate: future(-30), location: null },
      { id: 'm1', title: 'General body meeting', meetingDate: future(4), location: 'Clubhouse' },
      { id: 'm2', title: 'Later meeting', meetingDate: future(40), location: null },
    ] }),
  },
}));
jest.mock('@/api/endpoints/events.api', () => ({
  eventsApi: { list: async () => ({ data: [
    { id: 'e0', title: 'Cancelled mela', eventDate: future(2), status: 'CANCELLED' },
    { id: 'e1', title: 'Ganesh Chaturthi', eventDate: future(10), status: 'PLANNED' },
  ] }) },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Asha', lastName: 'Rao', flatNumber: 'A-101', buildingName: 'Tower A' } }) }));
jest.mock('@/hooks/useBranding', () => ({ useBranding: () => ({ color: '#0D2147', tint: '#eee', onTint: '#111' }) }));
jest.mock('@/components/ui/NotificationBell', () => ({ NotificationBell: () => null }));
jest.mock('@/components/ui/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('@/components/visitors/PendingVisitorBanner', () => ({ PendingVisitorBanner: () => null }));

import ResidentDashboard from '../../app/(app)/resident/index';

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
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ResidentDashboard /></QueryClientProvider>); });
  await until(() => textOf(tree.root).includes('Quick Links'));
  trees.push(tree);
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });
beforeEach(() => {
  mockPush.mockReset();
  mockPreview = null;
  mockNotices = [{ id: 'a1', title: 'Lift service on Monday', content: 'Block B lift is out 10 to 12.', priority: 'NORMAL' }];
  mockBill = { id: 'b1', totalAmount: '3500', paidAmount: '1400', pendingAmount: '2100', isPaid: false, dueDate: future(5), billingPeriod: { kind: 'MONTHLY' } };
});

describe('the resident home', () => {
  it('puts the bill on the hero card with how much of it is paid, and a way to say it was paid', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('₹3,500');
    expect(text).toContain('Outstanding: ₹2,100');
    expect(text).toContain("I've Made Payment");
    expect(tree.root.findAll((n: any) => n.props.accessibilityLabel === '40 percent of this bill paid').length).toBeGreaterThan(0);
    // The three figure tiles: total, paid, due.
    for (const t of ['Total Bill', 'Paid', 'Due']) expect(text).toContain(t);
  });

  it('swipe strip: the bill that is due, the notice, the next meeting and the next event, and nothing stale', async () => {
    const text = textOf(await mount().then((t) => t.root));
    expect(text).toContain("What's Happening");
    expect(text).toContain('is due');
    expect(text).toContain('Lift service on Monday');
    expect(text).toContain('General body meeting'); // the nearest future meeting
    expect(text).not.toContain('Old meeting');
    expect(text).not.toContain('Later meeting');
    expect(text).toContain('Ganesh Chaturthi');
    expect(text).not.toContain('Cancelled mela');
  });

  it('has no due card once the bill is paid, and says the resident is up to date', async () => {
    mockBill = { ...mockBill, paidAmount: '3500', pendingAmount: '0', isPaid: true };
    const text = textOf(await mount().then((t) => t.root));
    expect(text).not.toContain('is due');
    expect(text).not.toContain("I've Made Payment");
    expect(text).toContain('PAID');
  });

  it('says there is nothing to pay when there is no bill', async () => {
    mockBill = null;
    const text = textOf(await mount().then((t) => t.root));
    expect(text).toContain("No pending bill. You're all caught up!");
    expect(text).not.toContain('Total Bill');
  });

  it('opens the screen of the shortcut that is tapped', async () => {
    const tree = await mount();
    const tap = async (label: string) => act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => n.props.accessibilityLabel === label).props.onPress(); });
    await tap('Visitors');
    expect(mockPush).toHaveBeenLastCalledWith('/(app)/visitors');
    await tap('Vehicles');
    expect(mockPush).toHaveBeenLastCalledWith('/(app)/vehicles');
    await tap('Finances');
    expect(mockPush).toHaveBeenLastCalledWith('/(app)/resident/finances');
  });
});

describe('a resident when nothing has been posted', () => {
  it('still gets the strip, with cards for what a resident can do', async () => {
    mockNotices = [];
    mockBill = { ...mockBill, paidAmount: '3500', pendingAmount: '0', isPaid: true };
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain("What's Happening");
    // The nearest meeting and event are real cards; one prompt tops the strip up to three.
    expect(text).toContain('General body meeting');
    expect(text).toContain('Ganesh Chaturthi');
    expect(text).toContain('Need something fixed?');
    expect(text).not.toContain('Expecting a guest?');
  });
});
