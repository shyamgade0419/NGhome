/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Deleting an account that was entered by mistake: only an admin is offered it, it asks first, and the answer
 * says whether the account was deleted or (because it had been used) only taken off the lists.
 */

import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockIsAdmin = true;
const mockRemove = jest.fn();

jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: {
    list: jest.fn(async () => [{ id: 'a1', name: 'Wrong amount', accountType: 'CURRENT', bankName: 'HDFC', currentBalance: '99999' }]),
    transactions: jest.fn(async () => ({ data: [] })),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
  fundsApi: { list: jest.fn(async () => []), summary: jest.fn(async () => null), create: jest.fn(), contribute: jest.fn() },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import AccountsScreen from '../../app/(app)/admin/accounts/index';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const deleteButton = (tree: any) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => n.props.accessibilityLabel === 'Delete account');

async function openAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><AccountsScreen /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('Wrong amount'));
  const row = tree.root.findAllByType(TouchableOpacity).find((n: any) => textOf(n).includes('Wrong amount'));
  await act(async () => { row.props.onPress(); });
  await until(() => textOf(tree.root).includes('current balance'));
  return tree;
}

beforeEach(() => {
  mockIsAdmin = true;
  mockRemove.mockReset().mockResolvedValue({ id: 'a1', name: 'Wrong amount', deleted: true, removedFromLists: false });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Delete account', () => {
  it('is offered to the admin, and asks before deleting', async () => {
    const tree = await openAccount();
    await until(() => deleteButton(tree).length === 1);
    await act(async () => { deleteButton(tree)[0].props.onPress(); });

    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete Wrong amount?');
    expect(ask).toBeDefined();
    expect(ask[1]).toContain('its history is kept');
    expect(mockRemove).not.toHaveBeenCalled(); // nothing happens until the admin confirms
  });

  it('deletes after the admin confirms, and says so', async () => {
    const tree = await openAccount();
    await until(() => deleteButton(tree).length === 1);
    await act(async () => { deleteButton(tree)[0].props.onPress(); });
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete Wrong amount?');
    await act(async () => { ask[2].find((b: any) => b.text === 'Delete').onPress(); });

    await until(() => mockRemove.mock.calls.length === 1);
    expect(mockRemove).toHaveBeenCalledWith('a1');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Account deleted'));
  });

  it('says it was taken off the lists when the account had already been used', async () => {
    mockRemove.mockResolvedValue({ id: 'a1', name: 'Wrong amount', deleted: false, removedFromLists: true });
    const tree = await openAccount();
    await until(() => deleteButton(tree).length === 1);
    await act(async () => { deleteButton(tree)[0].props.onPress(); });
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete Wrong amount?');
    await act(async () => { ask[2].find((b: any) => b.text === 'Delete').onPress(); });

    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Account removed'));
    const done = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Account removed');
    expect(done[1]).toContain('history is kept');
  });

  it('shows the server reason when it cannot be deleted', async () => {
    mockRemove.mockRejectedValue({ response: { data: { message: 'This account was just used by another change.' } } });
    const tree = await openAccount();
    await until(() => deleteButton(tree).length === 1);
    await act(async () => { deleteButton(tree)[0].props.onPress(); });
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete Wrong amount?');
    await act(async () => { ask[2].find((b: any) => b.text === 'Delete').onPress(); });

    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Error'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Error')[1]).toContain('just used');
  });

  it('is not offered to anyone but an admin', async () => {
    mockIsAdmin = false;
    const tree = await openAccount();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(deleteButton(tree)).toHaveLength(0);
  });
});
