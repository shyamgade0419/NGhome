/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Choosing who a notification goes to: the rules (what can be sent, what the button says, what is sent), and the compose
 * screen that uses them: everyone by default, buildings and flats picked from the society's own, nothing sent until a choice
 * is made, and the sender told how many people it reached.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  EVERYONE,
  allSelected,
  choiceProblem,
  sendLabel,
  sentMessage,
  toPayload,
  toggleAll,
  toggleId,
  withKind,
} from '@/notifications/audienceChoice';

const mockSend = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
jest.mock('@/api/endpoints/notifications.api', () => ({
  notificationsApi: { send: (...a: unknown[]) => mockSend(...a) },
}));
jest.mock('@/api/endpoints/societies.api', () => ({
  societiesApi: {
    getBuildings: async () => ({ data: [{ id: 'bA', name: 'Tower A', isActive: true }, { id: 'bB', name: 'Tower B', isActive: true }, { id: 'bX', name: 'Old block', isActive: false }] }),
    getFlats: async ({ buildingId }: { buildingId: string }) => ({
      data: buildingId === 'bA' ? [{ id: 'fA1', flatCode: 'A-101' }, { id: 'fA2', flatCode: 'A-102' }] : [{ id: 'fB1', flatCode: 'B-201' }],
    }),
  },
}));

import { ComposeNotification } from '@/components/notifications/ComposeNotification';
import { Button } from '@/components/ui/Button';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const trees: any[] = [];
const onClose = jest.fn();
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ComposeNotification onClose={onClose} /></QueryClientProvider>); });
  trees.push(tree);
  return tree;
}
const byLabel = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === label)[0];
const press = async (tree: any, label: string) => {
  const t = byLabel(tree, label);
  expect(t).toBeDefined();
  await act(async () => { t.props.onPress(); });
};
const sendButton = (tree: any) => tree.root.findAll((n: any) => n.type === Button)[0];
const typeInto = async (tree: any, label: string, text: string) => {
  const input = tree.root.findAll((n: any) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
  await act(async () => { input.props.onChangeText(text); });
};
const fill = async (tree: any) => { await typeInto(tree, 'Title', 'Water off'); await typeInto(tree, 'Message', 'Supply is off 10 to 2'); };

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ recipientCount: 5 });
  onClose.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('audience rules', () => {
  it('adds an id that is not there and removes one that is', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('selects every flat in a building, or clears them all when they were all selected', () => {
    expect(toggleAll(['x'], ['a', 'b'])).toEqual(['x', 'a', 'b']);
    expect(toggleAll(['x', 'a'], ['a', 'b'])).toEqual(['x', 'a', 'b']); // some chosen: complete the set
    expect(toggleAll(['x', 'a', 'b'], ['a', 'b'])).toEqual(['x']); // all chosen: clear them
    expect(allSelected(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(allSelected(['a'], ['a', 'b'])).toBe(false);
    expect(allSelected(['a'], [])).toBe(false);
  });

  it('needs a building or a flat before it can be sent, and nothing else', () => {
    expect(choiceProblem(EVERYONE)).toBeNull();
    expect(choiceProblem({ ...EVERYONE, kind: 'COMMITTEE' })).toBeNull();
    expect(choiceProblem({ ...EVERYONE, kind: 'STAFF' })).toBeNull();
    expect(choiceProblem({ ...EVERYONE, kind: 'BUILDING' })).toMatch(/building/i);
    expect(choiceProblem({ ...EVERYONE, kind: 'SPECIFIC_FLATS' })).toMatch(/flat/i);
    expect(choiceProblem({ ...EVERYONE, kind: 'BUILDING', buildingIds: ['bA'] })).toBeNull();
    expect(choiceProblem({ ...EVERYONE, kind: 'SPECIFIC_FLATS', flatIds: ['fA1'] })).toBeNull();
  });

  it('keeps what was picked when switching kind and back', () => {
    const picked = { ...EVERYONE, kind: 'BUILDING' as const, buildingIds: ['bA'] };
    expect(withKind(withKind(picked, 'COMMITTEE'), 'BUILDING').buildingIds).toEqual(['bA']);
  });

  it('sends the audience, and only the list that belongs to it', () => {
    expect(toPayload(EVERYONE)).toEqual({ audience: 'ALL_RESIDENTS' });
    expect(toPayload({ kind: 'COMMITTEE', buildingIds: ['bA'], flatIds: ['fA1'] })).toEqual({ audience: 'COMMITTEE' });
    expect(toPayload({ kind: 'BUILDING', buildingIds: ['bA', 'bB'], flatIds: ['fA1'] })).toEqual({ audience: 'BUILDING', audienceConfig: { buildingIds: ['bA', 'bB'] } });
    expect(toPayload({ kind: 'SPECIFIC_FLATS', buildingIds: ['bA'], flatIds: ['fA1'] })).toEqual({ audience: 'SPECIFIC_FLATS', audienceConfig: { flatIds: ['fA1'] } });
  });

  it('words the button for who it goes to', () => {
    expect(sendLabel(EVERYONE)).toBe('Send to All Members');
    expect(sendLabel({ ...EVERYONE, kind: 'COMMITTEE' })).toBe('Send to the committee');
    expect(sendLabel({ ...EVERYONE, kind: 'STAFF' })).toBe('Send to the staff');
    expect(sendLabel({ ...EVERYONE, kind: 'BUILDING' })).toBe('Send to buildings');
    expect(sendLabel({ ...EVERYONE, kind: 'BUILDING', buildingIds: ['a'] })).toBe('Send to 1 building');
    expect(sendLabel({ ...EVERYONE, kind: 'BUILDING', buildingIds: ['a', 'b'] })).toBe('Send to 2 buildings');
    expect(sendLabel({ ...EVERYONE, kind: 'SPECIFIC_FLATS', flatIds: ['a', 'b', 'c'] })).toBe('Send to 3 flats');
  });

  it('tells the sender how many it reached, and says so when it reached nobody', () => {
    expect(sentMessage(1).message).toBe('Notification sent to 1 person.');
    expect(sentMessage(12).message).toBe('Notification sent to 12 people.');
    expect(sentMessage(0).title).toBe('Nobody to send to');
    expect(sentMessage(undefined)).toEqual({ title: 'Sent', message: 'Notification sent.' });
  });
});

describe('Send Notification screen', () => {
  it('sends to everyone by default, once a title and message are written', async () => {
    const tree = await mount();
    expect(sendButton(tree).props.label).toBe('Send to All Members');
    expect(sendButton(tree).props.disabled).toBe(true); // nothing written yet
    await fill(tree);
    expect(sendButton(tree).props.disabled).toBe(false);
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => mockSend.mock.calls.length === 1);
    expect(mockSend).toHaveBeenCalledWith({ title: 'Water off', body: 'Supply is off 10 to 2', audience: 'ALL_RESIDENTS' });
    await until(() => onClose.mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0]).toEqual(['Sent', 'Notification sent to 5 people.']);
  });

  it('will not send to buildings until one is ticked, then sends to just those', async () => {
    const tree = await mount();
    await fill(tree);
    await press(tree, 'Send to Buildings');
    await until(() => !!byLabel(tree, 'Tower A'));
    expect(byLabel(tree, 'Old block')).toBeUndefined(); // an inactive building is not offered
    expect(sendButton(tree).props.disabled).toBe(true);
    expect(sendButton(tree).props.label).toBe('Send to buildings');

    await press(tree, 'Tower B');
    await press(tree, 'Tower A');
    expect(sendButton(tree).props.disabled).toBe(false);
    expect(sendButton(tree).props.label).toBe('Send to 2 buildings');
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => mockSend.mock.calls.length === 1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ audience: 'BUILDING', audienceConfig: { buildingIds: ['bB', 'bA'] } });
  });

  it('lets flats be picked within a building, across buildings, and sends just those', async () => {
    const tree = await mount();
    await fill(tree);
    await press(tree, 'Send to Flats');
    await until(() => !!byLabel(tree, 'Flat A-101'));
    expect(sendButton(tree).props.disabled).toBe(true);

    await press(tree, 'Flat A-102');
    await press(tree, 'Building Tower B');
    await until(() => !!byLabel(tree, 'Flat B-201'));
    await press(tree, 'Flat B-201');
    expect(sendButton(tree).props.label).toBe('Send to 2 flats');
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => mockSend.mock.calls.length === 1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({ audience: 'SPECIFIC_FLATS', audienceConfig: { flatIds: ['fA2', 'fB1'] } });
  });

  it('selects every flat in a building at once', async () => {
    const tree = await mount();
    await fill(tree);
    await press(tree, 'Send to Flats');
    await until(() => !!byLabel(tree, 'Select all flats in this building'));
    await press(tree, 'Select all flats in this building');
    expect(sendButton(tree).props.label).toBe('Send to 2 flats');
    await press(tree, 'Select all flats in this building'); // all chosen, so this clears them
    expect(sendButton(tree).props.disabled).toBe(true);
  });

  it('sends to the committee with no list', async () => {
    const tree = await mount();
    await fill(tree);
    await press(tree, 'Send to Committee');
    expect(sendButton(tree).props.label).toBe('Send to the committee');
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => mockSend.mock.calls.length === 1);
    expect(mockSend.mock.calls[0][0]).toEqual({ title: 'Water off', body: 'Supply is off 10 to 2', audience: 'COMMITTEE' });
  });

  it('says so when it reached nobody', async () => {
    mockSend.mockResolvedValue({ recipientCount: 0 });
    const tree = await mount();
    await fill(tree);
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Nobody to send to');
  });

  it('shows the server\'s reason when sending fails, and stays open', async () => {
    mockSend.mockRejectedValue({ response: { data: { message: 'Choose at least one building to send to.' } } });
    const tree = await mount();
    await fill(tree);
    await act(async () => { sendButton(tree).props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0]).toEqual(['Error', 'Choose at least one building to send to.']);
    expect(onClose).not.toHaveBeenCalled();
  });
});
