/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The gate's parcels, rendered. What matters: only a parcel still at the gate can be
 * handed over or sent back; a recorded parcel carries a request id the server can
 * recognise (same id after a dropped connection, a new one once the server answered);
 * and what residents told the gate is on screen before a delivery arrives.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const parcel = (over: Record<string, unknown>) => ({
  id: 'p', flatId: 'f1', flatCode: 'A-403', courier: 'Amazon', recipientName: null, note: null, status: 'RECEIVED',
  receivedAt: '2026-10-30T10:00:00Z', closedAt: null, collectedByName: null, ...over,
});

const mockParcels = [
  parcel({ id: 'p-held', courier: 'Amazon', status: 'RECEIVED' }),
  parcel({ id: 'p-done', courier: 'Flipkart', status: 'COLLECTED', closedAt: '2026-10-30T11:00:00Z', collectedByName: 'Asha' }),
  parcel({ id: 'p-back', courier: 'Myntra', status: 'RETURNED', closedAt: '2026-10-30T11:30:00Z' }),
];
const mockExpected = [
  { id: 'x1', flatId: 'f1', flatCode: 'B-101', company: 'Swiggy', instruction: 'LEAVE_AT_GATE', note: 'Dog at home', validFrom: '2026-10-30T09:00:00Z', validUntil: '2026-10-30T20:00:00Z', maxUses: 1, usedCount: 0, state: 'ACTIVE' },
];

const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === '/gate/parcels') return { data: { data: mockParcels } };
      if (url === '/gate/deliveries/expected') return { data: { data: mockExpected } };
      if (url === '/gate/flats') return { data: { data: [{ id: 'f1', flatCode: 'A-403', buildingName: 'Block A' }] } };
      return { data: { data: [] } };
    }),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ParcelsPanel } from '@/components/gate/ParcelsPanel';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);
const serverError = (message: string, status = 409) => Object.assign(new Error(message), { response: { status, data: { message } } });

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><ParcelsPanel /></QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({ data: { data: {} } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('Parcels at the gate — the list', () => {
  it('offers "Hand over" and "Send back" only for the parcel still held', async () => {
    const tree = await mount();
    expect(buttons(tree, 'Hand over')).toHaveLength(1);
    expect(buttons(tree, 'Send back')).toHaveLength(1);
  });

  it('shows how closed parcels ended, and who took one', async () => {
    const text = textOf((await mount()).root);
    expect(text).toContain('Collected');
    expect(text).toContain('Taken by Asha');
    expect(text).toContain('Sent back');
  });

  it('puts what residents asked of the gate in front of the guard', async () => {
    const text = textOf((await mount()).root);
    expect(text).toContain('Residents are expecting');
    expect(text).toContain('B-101');
    expect(text).toContain('Swiggy');
    expect(text).toContain('Leave at gate');
    expect(text).toContain('Dog at home');
  });
});

describe('Parcels at the gate — hand over and send back', () => {
  it('hands over with the name of whoever took it', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Hand over')[0].props.onPress(); });
    const input = tree.root.findAllByType(TextInput).find((i: any) => i.props.placeholder === 'Who is taking it? (optional)');
    await act(async () => { input.props.onChangeText('  Asha Rao '); });
    await act(async () => { buttons(tree, 'Confirm hand-over')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/parcels/p-held/hand-over', { collectedByName: 'Asha Rao' });
  });

  it('hands over with no name when none is typed', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Hand over')[0].props.onPress(); });
    await act(async () => { buttons(tree, 'Confirm hand-over')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/parcels/p-held/hand-over', {});
  });

  it('asks before sending a parcel back, and does nothing if the guard backs out', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Send back')[0].props.onPress(); });
    expect(Alert.alert).toHaveBeenCalledWith(expect.stringContaining('Send Amazon parcel back'), expect.any(String), expect.any(Array));
    expect(mockPost).not.toHaveBeenCalled();
    const choices = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { choices.find((c) => c.text === 'Send back')!.onPress!(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/parcels/p-held/return');
  });

  it('shows what the server said when it refuses', async () => {
    mockPost.mockRejectedValueOnce(serverError('This parcel was already handed over.'));
    const tree = await mount();
    await act(async () => { buttons(tree, 'Hand over')[0].props.onPress(); });
    await act(async () => { buttons(tree, 'Confirm hand-over')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not hand over', 'This parcel was already handed over.');
  });
});

describe('Parcels at the gate — recording one', () => {
  async function fill(tree: any, courier = 'Amazon') {
    await act(async () => { buttons(tree, 'Record a parcel')[0].props.onPress(); });
    await flush();
    await act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => textOf(n) === 'A-403 | Block A' || textOf(n).startsWith('A-403'))!.props.onPress(); });
    await act(async () => { buttons(tree, courier)[0].props.onPress(); });
  }
  const send = (tree: any) => buttons(tree, 'Tell the resident')[0];

  it('will not send until a flat and a courier are chosen', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Record a parcel')[0].props.onPress(); });
    expect(send(tree).props.disabled).toBeTruthy();
    await fill(tree);
    expect(send(tree).props.disabled).toBeFalsy();
  });

  it('sends the flat, courier and a request id', async () => {
    mockPost.mockResolvedValue({ data: { data: { parcel: parcel({ id: 'new' }), duplicate: false, notifiedResidents: 2 } } });
    const tree = await mount();
    await fill(tree, 'Zepto');
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/parcels', { flatId: 'f1', courier: 'Zepto', clientRequestId: expect.any(String) });
    expect(Alert.alert).toHaveBeenCalledWith('Resident told', expect.stringContaining('A-403'));
  });

  it('says plainly when nobody could be told', async () => {
    mockPost.mockResolvedValue({ data: { data: { parcel: parcel({ id: 'new' }), duplicate: false, notifiedResidents: 0 } } });
    const tree = await mount();
    await fill(tree);
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('No one could be told', expect.stringContaining('A-403'));
  });

  it('retries a dropped connection with the SAME request id, so the server can recognise it', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: { data: { parcel: parcel({ id: 'new' }), duplicate: false, notifiedResidents: 1 } } });
    const tree = await mount();
    await fill(tree);
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    const [first, second] = mockPost.mock.calls.map((c) => c[1].clientRequestId);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('uses a NEW request id once the server has actually answered', async () => {
    mockPost.mockRejectedValue(serverError('That flat does not exist in this society.', 404));
    const tree = await mount();
    await fill(tree);
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    await act(async () => { send(tree).props.onPress(); });
    await flush();
    const [first, second] = mockPost.mock.calls.map((c) => c[1].clientRequestId);
    expect(second).not.toBe(first);
  });
});
