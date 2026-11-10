/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The figures at the top of more list screens: a resident's payments and helpdesk requests, and an admin's announcements
 * and meetings. Each is worked out from the list the screen already has.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const ahead = (d: number) => new Date(Date.now() + d * day).toISOString();

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/helpdesk/RequestThread', () => ({ RequestThread: () => null }));
jest.mock('@/api/client', () => ({ __esModule: true, default: { delete: jest.fn(), post: jest.fn(), get: jest.fn() } }));
jest.mock('@/api/endpoints/payments.api', () => ({
  paymentsApi: { getMyPayments: async () => ({ data: [
    { id: 'p1', amount: '3500', status: 'APPROVED', paymentMethod: 'UPI', createdAt: ago(40) },
    { id: 'p2', amount: '1500', status: 'APPROVED', paymentMethod: 'UPI', createdAt: ago(20) },
    { id: 'p3', amount: '3500', status: 'PENDING', paymentMethod: 'UPI', createdAt: ago(1) },
    { id: 'p4', amount: '3500', status: 'UNDER_REVIEW', paymentMethod: 'CASH', createdAt: ago(2) },
    { id: 'p5', amount: '900', status: 'REJECTED', paymentMethod: 'UPI', createdAt: ago(5), reviewNotes: 'Wrong amount' },
  ] }) },
}));
jest.mock('@/api/endpoints/helpdesk.api', () => ({
  helpdeskApi: { list: async () => ({ data: [
    { id: 'r1', title: 'Lift stuck', status: 'OPEN', priority: 'HIGH', category: 'LIFT', createdAt: ago(1) },
    { id: 'r2', title: 'Leak', status: 'IN_PROGRESS', priority: 'MEDIUM', category: 'PLUMBING', createdAt: ago(2) },
    { id: 'r3', title: 'Light out', status: 'RESOLVED', priority: 'LOW', category: 'ELECTRICAL', createdAt: ago(3) },
    { id: 'r4', title: 'Paint', status: 'CLOSED', priority: 'LOW', category: 'OTHER', createdAt: ago(9) },
  ] }) },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: { getAnnouncements: async () => ({ data: [
    { id: 'a1', title: 'Water cut', content: 'x', audience: 'ALL_RESIDENTS', priority: 'URGENT', isPublished: true, publishAt: ago(1) },
    { id: 'a2', title: 'AGM', content: 'x', audience: 'ALL_RESIDENTS', priority: 'HIGH', isPublished: true, publishAt: ago(2) },
    { id: 'a3', title: 'Diwali', content: 'x', audience: 'ALL_RESIDENTS', priority: 'NORMAL', isPublished: true, publishAt: ago(3) },
    { id: 'a4', title: 'Draft', content: 'x', audience: 'ALL_RESIDENTS', priority: 'LOW', isPublished: false, publishAt: null },
  ] }) },
}));
jest.mock('@/api/endpoints/meetings.api', () => ({
  meetingsApi: { list: async () => ({ data: [
    { id: 'm1', title: 'AGM', meetingDate: ahead(4), location: 'Clubhouse', isPublished: true },
    { id: 'm2', title: 'Budget', meetingDate: ahead(30), location: null, isPublished: true },
    { id: 'm3', title: 'Old one', meetingDate: ago(60), location: null, isPublished: true },
  ] }) },
}));

import ResidentPaymentsScreen from '../../app/(app)/resident/payments/index';
import ResidentHelpdeskScreen from '../../app/(app)/resident/helpdesk';
import AnnouncementsScreen from '../../app/(app)/admin/announcements/index';
import MeetingsScreen from '../../app/(app)/admin/meetings/index';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const flatText = (node: any) => textOf(node).replace(/\s*\|\s*/g, ' ');
const trees: any[] = [];
async function mount(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}>{el}</QueryClientProvider>); });
  trees.push(tree);
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });

describe('my payments (resident)', () => {
  it('adds up what was approved, counts what is waiting and what was sent back', async () => {
    const tree = await mount(<ResidentPaymentsScreen />);
    await until(() => flatText(tree.root).includes('Sent back'));
    // Approved ₹5,000 (3,500 + 1,500); waiting 2 (pending and under review); sent back 1.
    expect(flatText(tree.root)).toMatch(/Approved ₹5,000.*Waiting 2.*Sent back 1/s);
  });
});

describe('helpdesk (resident)', () => {
  it('counts their requests by state, closed ones with resolved', async () => {
    const tree = await mount(<ResidentHelpdeskScreen />);
    await until(() => flatText(tree.root).includes('Resolved'));
    expect(flatText(tree.root)).toMatch(/Open 1.*In progress 1.*Resolved 2/s);
    expect(textOf(tree.root)).toContain('Lift stuck');
  });
});

describe('announcements (admin)', () => {
  it('counts what has been posted, what is live and what is urgent', async () => {
    const tree = await mount(<AnnouncementsScreen />);
    await until(() => flatText(tree.root).includes('Urgent'));
    // Four posted, three live, two urgent or high.
    expect(flatText(tree.root)).toMatch(/Posted 4.*Live 3.*Urgent 2/s);
  });
});

describe('meetings (admin)', () => {
  it('counts the meetings still to come and the ones held', async () => {
    const tree = await mount(<MeetingsScreen />);
    await until(() => flatText(tree.root).includes('Held'));
    expect(flatText(tree.root)).toMatch(/Upcoming 2.*Held 1.*In all 3/s);
  });
});
