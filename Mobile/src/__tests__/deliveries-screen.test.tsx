/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident's Deliveries screen, rendered. What matters: a parcel at the gate is
 * called out; only an instruction that can still be withdrawn offers "Cancel"; and a new
 * instruction is sent as what the resident chose, with an end time and no flat of its own
 * (the server takes the flat from the sign-in).
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockParcels = [
  { id: 'p1', flatId: 'f1', flatCode: 'A-403', courier: 'Amazon', recipientName: 'Asha', note: 'Large box', status: 'RECEIVED', receivedAt: '2026-10-30T10:00:00Z', closedAt: null, collectedByName: null },
  { id: 'p2', flatId: 'f1', flatCode: 'A-403', courier: 'Flipkart', recipientName: null, note: null, status: 'COLLECTED', receivedAt: '2026-10-29T10:00:00Z', closedAt: '2026-10-29T12:00:00Z', collectedByName: 'Asha' },
];
const instr = (over: Record<string, unknown>) => ({
  id: 'i', flatId: 'f1', company: 'Amazon', instruction: 'ALLOW_ENTRY', note: null, validFrom: '2026-10-30T09:00:00Z', validUntil: '2026-10-30T20:00:00Z',
  maxUses: 1, usedCount: 0, state: 'ACTIVE', ...over,
});
const mockInstructions = [
  instr({ id: 'i-live', company: 'Swiggy' }),
  instr({ id: 'i-used', company: 'Zepto', state: 'USED', usedCount: 1 }),
  instr({ id: 'i-off', company: 'Myntra', state: 'CANCELLED' }),
];

const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === '/parcels/my') return { data: { data: mockParcels } };
      if (url === '/delivery-expectations/my') return { data: { data: mockInstructions } };
      return { data: { data: [] } };
    }),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

import DeliveriesScreen from '../../app/(app)/deliveries/index';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><DeliveriesScreen /></QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({ data: { data: {} } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('Deliveries — parcels', () => {
  it('says how many are waiting and tells the resident to collect them', async () => {
    const text = textOf((await mount()).root);
    expect(text).toContain('1 waiting at the gate');
    expect(text).toContain('Collect it from the gate.');
    expect(text).toContain('For Asha');
    expect(text).toContain('Taken by Asha');
  });
});

describe('Deliveries — instructions', () => {
  async function openInstructions() {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Instructions')[0].props.onPress(); });
    return tree;
  }

  it('offers "Cancel" only for an instruction that can still be withdrawn', async () => {
    const tree = await openInstructions();
    expect(buttons(tree, 'Cancel')).toHaveLength(1);
    const text = textOf(tree.root);
    expect(text).toContain('Swiggy');
    expect(text).toContain('Used');
    expect(text).toContain('Cancelled');
  });

  it('cancels that instruction by id', async () => {
    const tree = await openInstructions();
    await act(async () => { buttons(tree, 'Cancel')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/delivery-expectations/i-live/cancel');
  });

  it('shows what the server said when cancelling fails', async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { message: 'This was already cancelled.' } } }));
    const tree = await openInstructions();
    await act(async () => { buttons(tree, 'Cancel')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not cancel', 'This was already cancelled.');
  });
});

describe('Deliveries — telling the gate', () => {
  const open = async (tree: any) => act(async () => { tree.root.findByProps({ accessibilityLabel: 'A delivery is coming' }).props.onPress(); });
  const tell = (tree: any) => buttons(tree, 'Tell the gate')[0];

  it('will not send without knowing who is delivering', async () => {
    const tree = await mount();
    await open(tree);
    expect(tell(tree).props.disabled).toBeTruthy();
    await act(async () => { buttons(tree, 'Amazon')[0].props.onPress(); });
    expect(tell(tree).props.disabled).toBeFalsy();
  });

  it('sends the choice with an end time, and never a flat', async () => {
    const tree = await mount();
    await open(tree);
    await act(async () => { buttons(tree, 'Swiggy')[0].props.onPress(); });
    await act(async () => { buttons(tree, 'Leave at gate')[0].props.onPress(); });
    await act(async () => { buttons(tree, '3 hours')[0].props.onPress(); });
    const note = tree.root.findAllByType(TextInput).find((i: any) => i.props.placeholder === 'Note for the guard (optional)');
    await act(async () => { note.props.onChangeText('  Back door is locked '); });
    const before = Date.now();
    await act(async () => { tell(tree).props.onPress(); });
    await flush();

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('/delivery-expectations');
    expect(body).toMatchObject({ company: 'Swiggy', instruction: 'LEAVE_AT_GATE', note: 'Back door is locked' });
    expect(body).not.toHaveProperty('flatId');
    const hours = (new Date(body.validUntil).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(2.9);
    expect(hours).toBeLessThan(3.1);
  });

  it('explains what the chosen instruction does', async () => {
    const tree = await mount();
    await open(tree);
    expect(textOf(tree.root)).toContain('lets the delivery person in without calling you');
    await act(async () => { buttons(tree, 'Leave at gate')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('keeps the parcel');
  });
});
