/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The gate's staff list, rendered. What matters: on-duty people are shown with their shift and
 * post; only someone not yet in gets "Check in" and only someone inside gets "Check out"; check-out
 * asks first; and nothing about pay or phone numbers is on screen.
 */

import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const person = (over: Record<string, unknown>) => ({
  employeeId: 'e', name: 'Someone', designation: 'Housekeeping', shiftName: null, shiftStart: null, shiftEnd: null, post: null, dayOff: false,
  status: null, checkInAt: null, checkOutAt: null, inside: false, ...over,
});
const mockStaff = [
  person({ employeeId: 'e-in', name: 'Inside Ishaan', designation: 'Security', shiftName: 'Morning', shiftStart: '06:00', shiftEnd: '14:00', post: 'Main gate', status: 'PRESENT', checkInAt: '2026-10-30T00:40:00Z', inside: true }),
  person({ employeeId: 'e-wait', name: 'Waiting Wati', shiftName: 'Morning', shiftStart: '06:00', shiftEnd: '14:00' }),
  person({ employeeId: 'e-left', name: 'Left Lata', status: 'PRESENT', checkInAt: '2026-10-30T00:30:00Z', checkOutAt: '2026-10-30T08:30:00Z' }),
  person({ employeeId: 'e-abs', name: 'Absent Arun', status: 'ABSENT' }),
  person({ employeeId: 'e-off', name: 'Off Om', dayOff: true }),
];

const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => (url === '/gate/staff' ? { data: { data: mockStaff } } : { data: { data: [] } })),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { StaffPanel } from '@/components/gate/StaffPanel';

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
    tree = TestRenderer.create(<QueryClientProvider client={qc}><StaffPanel /></QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({ data: { data: { attendance: {}, alreadyIn: false, alreadyOut: false } } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Gate — staff', () => {
  it('shows each person with their duty, status and times, and a summary', async () => {
    const text = textOf((await mount()).root);
    expect(text).toContain('1 inside · 1 still to come');
    expect(text).toContain('Morning 06:00–14:00 · Main gate');
    expect(text).toContain('Inside');
    expect(text).toContain('Left');
    expect(text).toContain('Absent');
    expect(text).toContain('Day off');
    expect(text).toContain('Not in yet');
    expect(text).toMatch(/In .* · Out /);
  });

  it('offers "Check in" to everyone not yet in (including someone marked absent), and "Check out" only to the one inside', async () => {
    const tree = await mount();
    expect(buttons(tree, 'Check in')).toHaveLength(3); // waiting, absent, day off
    expect(buttons(tree, 'Check out')).toHaveLength(1);
  });

  it('checks a person in by id', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Check in')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/staff/e-wait/check-in');
  });

  it('says so when they were already checked in', async () => {
    mockPost.mockResolvedValue({ data: { data: { attendance: {}, alreadyIn: true } } });
    const tree = await mount();
    await act(async () => { buttons(tree, 'Check in')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Already in', expect.stringContaining('Waiting Wati'));
  });

  it('asks before recording an exit, and records it for that person only when confirmed', async () => {
    const tree = await mount();
    await act(async () => { buttons(tree, 'Check out')[0].props.onPress(); });
    expect(mockPost).not.toHaveBeenCalled();
    const choices = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { choices.find((c) => c.text === 'Check out')!.onPress!(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/staff/e-in/check-out');
  });

  it('shows what the server said when it refuses', async () => {
    mockPost.mockRejectedValueOnce(serverError('This person has not been checked in, so they cannot be checked out.'));
    const tree = await mount();
    await act(async () => { buttons(tree, 'Check out')[0].props.onPress(); });
    const choices = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { choices.find((c) => c.text === 'Check out')!.onPress!(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not check out', 'This person has not been checked in, so they cannot be checked out.');
  });

  it('shows no pay details or phone numbers', async () => {
    const text = textOf((await mount()).root);
    expect(text).not.toMatch(/salary|₹|phone|\d{10}/i);
  });
});
