/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The gate screen, rendered. What matters at a gate: only an approved visitor
 * can be let in; a refused invitation code says so plainly; and a retried
 * request is recognisable to the server (same id after a dropped connection,
 * a new id once the server has actually answered).
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockEntry = (over: Record<string, unknown>) => ({
  id: 'e', flatId: 'f1', flatCode: 'A-403', invitationId: null, visitorName: 'Someone', visitorPhone: null, visitorType: 'GUEST',
  vehicleNumber: null, purpose: null, status: 'PENDING_APPROVAL', requestedAt: '2026-10-28T12:40:00Z', decidedAt: null, decisionNote: null,
  decisionMethod: null, checkedInAt: null, checkedOutAt: null, ...over,
});

const mockEntries = [
  mockEntry({ id: 'e-wait', visitorName: 'Waiting Wendy', status: 'PENDING_APPROVAL' }),
  mockEntry({ id: 'e-ok', visitorName: 'Approved Arun', status: 'APPROVED', decisionMethod: 'RESIDENT' }),
  mockEntry({ id: 'e-in', visitorName: 'Inside Isha', status: 'CHECKED_IN', checkedInAt: '2026-10-28T12:50:00Z' }),
  mockEntry({ id: 'e-no', visitorName: 'Declined Dev', status: 'REJECTED' }),
  mockEntry({ id: 'e-late', visitorName: 'Lapsed Lata', status: 'EXPIRED' }),
];

const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === '/gate/visitors') return { data: { data: mockEntries } };
      if (url === '/gate/flats') return { data: { data: [{ id: 'f1', flatCode: 'A-403', buildingName: 'Block A' }] } };
      return { data: { data: [] } };
    }),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { firstName: 'Gopal' }, logout: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import GateScreen from '../../app/(app)/guard/index';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

function textOf(node: any): string {
  return node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
}
// One entry per actual touchable: the wrapper components around it carry the same onPress and would be counted too.
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><GateScreen /></QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

const serverError = (message: string, status = 409) => Object.assign(new Error(message), { response: { status, data: { message } } });

describe('Gate screen — the list', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ data: { data: {} } });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('offers "Let in" only for the visitor who has been approved', async () => {
    const tree = await mount();
    expect(buttons(tree, 'Let in')).toHaveLength(1);
    expect(textOf(tree.root)).toContain('Approved Arun');
  });

  it('offers "Mark as left" only for someone who is inside', async () => {
    const tree = await mount();
    expect(buttons(tree, 'Mark as left')).toHaveLength(1);
  });

  it('tells the guard plainly what to do about each visitor who cannot come in', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('Do not let them in yet');
    expect(text).toContain('The resident declined. Do not let them in.');
    expect(text).toContain('No answer in time');
  });

  it('shows the headline counts', async () => {
    const tree = await mount();
    expect(textOf(tree.root)).toContain('1 inside');
    expect(textOf(tree.root)).toContain('1 waiting');
  });

  it('lets the visitor in by calling the check-in endpoint for that entry', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Let in')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/visitors/e-ok/check-in');
  });

  it('records an exit by calling check-out for that entry', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Mark as left')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/visitors/e-in/check-out');
  });

  it('shows what the server said when it refuses to let someone in', async () => {
    mockPost.mockRejectedValueOnce(serverError('The resident declined this visitor.'));
    const tree = await mount();
    await act(async () => { buttons(tree, 'Let in')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not let them in', 'The resident declined this visitor.');
  });
});

describe('Gate screen — invitation codes', () => {
  beforeEach(() => {
    mockPost.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  async function openCodeSheet(tree: any) {
    await act(async () => { buttons(tree, 'Enter code')[0].props.onPress(); });
    return tree.root.findAllByType(TextInput).find((i: any) => i.props.placeholder === 'XXXX-XXXX');
  }
  const typeCode = async (input: any, text: string) => act(async () => { input.props.onChangeText(text); });
  const check = (tree: any) => buttons(tree, 'Check code')[0];

  it('will not check an incomplete code', async () => {
    const tree = await mount();
    const input = await openCodeSheet(tree);
    await typeCode(input, 'k7qx');
    expect(check(tree).props.disabled).toBeTruthy();
    await typeCode(input, 'k7qx92md');
    expect(check(tree).props.disabled).toBeFalsy();
  });

  it('tidies what is typed and sends the code with a request id', async () => {
    mockPost.mockResolvedValue({ data: { data: { entry: mockEntry({ visitorName: 'Ravi', status: 'CHECKED_IN' }), duplicate: false } } });
    const tree = await mount();
    const input = await openCodeSheet(tree);
    await typeCode(input, ' k7qx 92md ');
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/scan', { code: 'K7QX-92MD', clientRequestId: expect.any(String) });
  });

  it('says "Let them in" with the visitor and flat when the code is good', async () => {
    mockPost.mockResolvedValue({ data: { data: { entry: mockEntry({ visitorName: 'Ravi Kumar', status: 'CHECKED_IN' }), duplicate: false } } });
    const tree = await mount();
    await typeCode(await openCodeSheet(tree), 'k7qx92md');
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    const text = textOf(tree.root);
    expect(text).toContain('Let them in');
    expect(text).toContain('Ravi Kumar');
    expect(text).toContain('Flat A-403');
  });

  it('says "Do not let them in" with the server\'s reason when the code is refused', async () => {
    mockPost.mockRejectedValue(serverError('This invitation has already been used.'));
    const tree = await mount();
    await typeCode(await openCodeSheet(tree), 'k7qx92md');
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    const text = textOf(tree.root);
    expect(text).toContain('Do not let them in');
    expect(text).toContain('This invitation has already been used.');
    expect(text).not.toContain('Let them in |');
  });

  it('retries a dropped connection with the SAME request id, so the server can recognise it', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: { data: { entry: mockEntry({ status: 'CHECKED_IN' }), duplicate: false } } });
    const tree = await mount();
    await typeCode(await openCodeSheet(tree), 'k7qx92md');
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    const [first, second] = mockPost.mock.calls.map((c) => c[1].clientRequestId);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('uses a NEW request id once the server has actually answered', async () => {
    mockPost.mockRejectedValue(serverError('This invitation has expired.'));
    const tree = await mount();
    await typeCode(await openCodeSheet(tree), 'k7qx92md');
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    await act(async () => { check(tree).props.onPress(); });
    await flush();
    const [first, second] = mockPost.mock.calls.map((c) => c[1].clientRequestId);
    expect(second).not.toBe(first);
  });
});
