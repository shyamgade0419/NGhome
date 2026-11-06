/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Switching off the parts of the app a society does not use: the Features screen, and the home screens and settings
 * list hiding what is off. Everything is on while the server has not answered, and for any answer it cannot read.
 */

import React from 'react';
import { Alert, Switch, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPush = jest.fn();
const mockGetFeatures = jest.fn();
const mockSetFeatures = jest.fn();
let mockAdmin = true;

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: {
    getFeatures: (...a: unknown[]) => mockGetFeatures(...a),
    setFeatures: (...a: unknown[]) => mockSetFeatures(...a),
    getAnnouncements: async () => ({ data: [] }),
    getMeetings: async () => ({ data: [{ id: 'm1', title: 'General body meeting', meetingDate: new Date(Date.now() + 4 * 86_400_000).toISOString(), location: null }] }),
    getBranding: async () => ({ appName: null, primaryColor: null, logoDataUri: null }),
  },
}));
jest.mock('@/api/endpoints/events.api', () => ({ eventsApi: { list: async () => ({ data: [{ id: 'e1', title: 'Ganesh Chaturthi', status: 'PLANNED', eventDate: new Date(Date.now() + 9 * 86_400_000).toISOString() }] }) } }));
jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    listPublishedPeriods: async () => [{ id: 'p1', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY' }],
    getCurrentPeriod: async () => ({ id: 'p1', periodYear: 2026, periodMonth: 10, status: 'PUBLISHED', kind: 'MONTHLY' }),
    getDashboardSummary: async () => ({ totalBilled: '1000', totalCollected: '0', totalOutstanding: '1000', totalExpenses: '0', accountBalance: '1', corpusBalance: '1', pendingApprovals: 0 }),
    getMyCurrentBill: async () => null,
    previewMyBill: async () => null,
  },
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { firstName: 'Priya', lastName: 'Nair', displayName: 'Priya Nair', email: 'p@x.com', currentRole: 'SOCIETY_ADMIN' }, logout: jest.fn() }),
  useIsSocietyAdmin: () => mockAdmin,
}));
jest.mock('@/hooks/useBranding', () => ({ useBranding: () => ({ color: '#0D2147', tint: '#eee', onTint: '#111' }) }));
jest.mock('@/components/ui/NotificationBell', () => ({ NotificationBell: () => null }));
jest.mock('@/components/ui/BrandMark', () => ({ BrandMark: () => null }));
jest.mock('@/components/visitors/PendingVisitorBanner', () => ({ PendingVisitorBanner: () => null }));

import FeaturesScreen from '../../app/(app)/admin/settings/features';
import SettingsScreen from '../../app/(app)/admin/settings/index';
import AdminDashboard from '../../app/(app)/admin/index';
import ResidentDashboard from '../../app/(app)/resident/index';
import { FEATURES, featureForRoute } from '@/features/catalog';

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
const allOn = () => Object.fromEntries(FEATURES.map((f) => [f.key, true]));
beforeEach(() => {
  mockPush.mockReset();
  mockSetFeatures.mockReset();
  mockSetFeatures.mockResolvedValue({});
  mockGetFeatures.mockReset();
  mockGetFeatures.mockResolvedValue(allOn());
  mockAdmin = true;
});
const hasLabel = (tree: any, label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label).length > 0;

describe('which screen belongs to which feature', () => {
  it.each([
    ['/(app)/visitors', 'visitors'], ['/(app)/admin/visitors', 'visitors'], ['/(app)/deliveries', 'deliveries'],
    ['/(app)/household-help', 'householdHelp'], ['/(app)/vehicles', 'parking'], ['/(app)/amenities', 'amenities'],
    ['/(app)/admin/amenities', 'amenities'], ['/(app)/resident/events', 'events'], ['/(app)/admin/meetings', 'meetings'],
    ['/(app)/forum', 'forum'], ['/(app)/chat', 'chat'], ['/(app)/admin/salaries', 'staff'],
  ])('%s is %s', (route, key) => expect(featureForRoute(route)).toBe(key));

  it('leaves the core of the app out of it: billing, payments, the helpdesk, accounts and the rest', () => {
    for (const r of ['/(app)/admin/maintenance', '/(app)/admin/payments', '/(app)/admin/helpdesk', '/(app)/admin/accounts', '/(app)/documents', '/(app)/directory']) expect(featureForRoute(r)).toBeNull();
  });
});

describe('the Features screen', () => {
  it('lists every feature with its switch, all on for a society that never changed them', async () => {
    const tree = await mount(<FeaturesScreen />);
    await until(() => tree.root.findAllByType(Switch).length === FEATURES.length);
    expect(textOf(tree.root)).toContain('Everything is switched on.');
    for (const f of FEATURES) expect(hasLabel(tree, f.label)).toBe(true);
    expect(tree.root.findAllByType(Switch).every((s: any) => s.props.value === true)).toBe(true);
  });

  it('shows what the server has switched off, and counts it', async () => {
    mockGetFeatures.mockResolvedValue({ ...allOn(), parking: false, amenities: false });
    const tree = await mount(<FeaturesScreen />);
    await until(() => textOf(tree.root).includes('2 switched off.'));
    const sw = (label: string) => tree.root.findAllByType(Switch).find((s: any) => s.props.accessibilityLabel === label);
    expect(sw('Vehicles and parking').props.value).toBe(false);
    expect(sw('Visitors and gate').props.value).toBe(true);
  });

  it('saves only the one that was switched, and shows it at once', async () => {
    // Like the real server: what was saved is what the next read returns.
    mockSetFeatures.mockImplementation(async (patch: Record<string, boolean>) => {
      mockGetFeatures.mockResolvedValue({ ...allOn(), ...patch });
      return {};
    });
    const tree = await mount(<FeaturesScreen />);
    await until(() => tree.root.findAllByType(Switch).length === FEATURES.length);
    await act(async () => { tree.root.findAllByType(Switch).find((s: any) => s.props.accessibilityLabel === 'Amenities and bookings').props.onValueChange(false); });
    expect(mockSetFeatures).toHaveBeenCalledWith({ amenities: false });
    await until(() => textOf(tree.root).includes('1 switched off.'));
  });

  it('puts the switch back and says why when the server refuses', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSetFeatures.mockRejectedValue({ response: { data: { message: 'Only an admin can do that.' } } });
    const tree = await mount(<FeaturesScreen />);
    await until(() => tree.root.findAllByType(Switch).length === FEATURES.length);
    await act(async () => { tree.root.findAllByType(Switch)[0].props.onValueChange(false); });
    await until(() => alert.mock.calls.length > 0);
    expect(alert).toHaveBeenCalledWith('Not saved', 'Only an admin can do that.');
    await until(() => tree.root.findAllByType(Switch)[0].props.value === true);
    alert.mockRestore();
  });

  it('is read-only for anyone who is not the admin', async () => {
    mockAdmin = false;
    const tree = await mount(<FeaturesScreen />);
    await until(() => tree.root.findAllByType(Switch).length === FEATURES.length);
    expect(tree.root.findAllByType(Switch).every((s: any) => s.props.disabled === true)).toBe(true);
    expect(textOf(tree.root)).toContain('Only the society admin can change these.');
  });
});

describe('what disappears when a feature is off', () => {
  it('hides the shortcuts and the meeting and event cards of the admin home, and keeps the rest', async () => {
    mockGetFeatures.mockResolvedValue({ ...allOn(), visitors: false, amenities: false, meetings: false, events: false, forum: false, chat: false });
    const tree = await mount(<AdminDashboard />);
    await until(() => textOf(tree.root).includes('Quick Actions'));
    await until(() => !hasLabel(tree, 'Gate Log'));
    for (const gone of ['Gate Log', 'Amenities', 'Community', 'Messages']) expect(hasLabel(tree, gone)).toBe(false);
    for (const kept of ['Billing', 'Verify', 'Expense', 'Helpdesk', 'Directory']) expect(hasLabel(tree, kept)).toBe(true);
    const text = textOf(tree.root);
    expect(text).not.toContain('General body meeting');
    expect(text).not.toContain('Ganesh Chaturthi');
    expect(text).not.toContain('Plan a meeting');
    expect(text).not.toContain('Organise an event');
  });

  it('shows everything before the server has answered, and when it cannot be read', async () => {
    mockGetFeatures.mockRejectedValue(new Error('network'));
    const tree = await mount(<AdminDashboard />);
    await until(() => textOf(tree.root).includes('Quick Actions'));
    for (const shown of ['Gate Log', 'Amenities', 'Community', 'Messages']) expect(hasLabel(tree, shown)).toBe(true);
  });

  it('hides the resident shortcuts and strip prompts for what is off', async () => {
    mockGetFeatures.mockResolvedValue({ ...allOn(), parking: false, visitors: false, deliveries: false, householdHelp: false, forum: false });
    const tree = await mount(<ResidentDashboard />);
    await until(() => textOf(tree.root).includes('Quick Links'));
    await until(() => !hasLabel(tree, 'Vehicles'));
    for (const gone of ['Vehicles', 'Visitors', 'Deliveries', 'Household Help', 'Community']) expect(hasLabel(tree, gone)).toBe(false);
    for (const kept of ['Events', 'Amenities', 'Messages', 'Directory']) expect(hasLabel(tree, kept)).toBe(true);
    expect(textOf(tree.root)).not.toContain('Expecting a guest?');
    expect(textOf(tree.root)).not.toContain('Meet your neighbours');
  });

  it('takes Meetings, Events and Salaries out of the settings list, and offers the Features screen', async () => {
    mockGetFeatures.mockResolvedValue({ ...allOn(), meetings: false, events: false, staff: false });
    const tree = await mount(<SettingsScreen />);
    await until(() => textOf(tree.root).includes('Features'));
    await until(() => !textOf(tree.root).includes('Salaries'));
    const text = textOf(tree.root);
    for (const gone of ['Meetings', 'Events & Activities', 'Salaries']) expect(text).not.toContain(gone);
    for (const kept of ['Society Settings', 'Features', 'Reports', 'Helpdesk']) expect(text).toContain(kept);
    await act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => /Switch off parts of the app/.test(textOf(n))).props.onPress(); });
    expect(mockPush).toHaveBeenLastCalledWith('/(app)/admin/settings/features');
  });
});
