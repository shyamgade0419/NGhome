/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The notifications screen says whether this phone will get alerts, and why not, and can prove it with a test.
 */

import React from 'react';
import { Alert, Linking, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockStatus: any = null;
const mockRegister = jest.fn();
const mockPushTest = jest.fn();

jest.mock('@/notifications/push', () => ({
  getPushStatus: async () => mockStatus,
  registerForPushNotificationsAsync: (...a: unknown[]) => mockRegister(...a),
}));
jest.mock('@/api/endpoints/notifications.api', () => ({
  notificationsApi: { pushTest: (...a: unknown[]) => mockPushTest(...a) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { PushStatusBanner } from '@/components/notifications/PushStatusBanner';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const byLabel = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => n.props.accessibilityLabel === label);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><PushStatusBanner /></QueryClientProvider>);
  });
  trees.push(tree);
  return tree;
}

const trees: any[] = [];
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

beforeEach(() => {
  mockStatus = null;
  mockRegister.mockReset().mockResolvedValue({ state: 'ready' });
  mockPushTest.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Phone alert status', () => {
  it('says alerts are on, and sends a test that reports success', async () => {
    mockStatus = { state: 'ready' };
    mockPushTest.mockResolvedValue({ devices: 1, accepted: 1, problems: [] });
    const tree = await mount();
    await until(() => textOf(tree.root).includes('Phone alerts are on'));
    await act(async () => { byLabel(tree, 'Send a test alert')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Test sent');
  });

  it('passes on why a test could not be delivered', async () => {
    mockStatus = { state: 'ready' };
    mockPushTest.mockResolvedValue({ devices: 1, accepted: 0, problems: ['InvalidCredentials — Unable to retrieve the FCM server key'] });
    const tree = await mount();
    await until(() => byLabel(tree, 'Send a test alert').length === 1);
    await act(async () => { byLabel(tree, 'Send a test alert')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    const call = (Alert.alert as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('The alert could not be delivered');
    expect(call[1]).toContain('InvalidCredentials');
  });

  it('says so when no phone is registered', async () => {
    mockStatus = { state: 'ready' };
    mockPushTest.mockResolvedValue({ devices: 0, accepted: 0, problems: [] });
    const tree = await mount();
    await until(() => byLabel(tree, 'Send a test alert').length === 1);
    await act(async () => { byLabel(tree, 'Send a test alert')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('No phone registered');
  });

  it('when notifications are turned off, points to the phone settings', async () => {
    mockStatus = { state: 'denied', detail: 'Notifications are turned off for NG Home on this phone.' };
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as any);
    const tree = await mount();
    await until(() => textOf(tree.root).includes('will not get alerts'));
    expect(textOf(tree.root)).toContain('turned off');
    await act(async () => { byLabel(tree, 'Open phone settings')[0].props.onPress(); });
    expect(open).toHaveBeenCalled();
  });

  it('when the phone could not be registered, shows the reason and tries again on request', async () => {
    mockStatus = { state: 'unavailable', detail: 'Default FirebaseApp is not initialized' };
    const tree = await mount();
    await until(() => textOf(tree.root).includes('Default FirebaseApp'));
    await act(async () => { byLabel(tree, 'Try again')[0].props.onPress(); });
    await until(() => mockRegister.mock.calls.length === 1);
  });
});
