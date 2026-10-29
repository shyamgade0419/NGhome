/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident's Household help screen and the guard's Help panel, rendered. What matters:
 * a new person's code is shown once and can be shared; a person already on the register is
 * linked without a new code; the guard can let in only someone active and not already inside,
 * sees who was let in, and retries safely (same id after a dropped connection, new id after the
 * server answered).
 */

import React from 'react';
import { Alert, Share, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mine = [
  { id: 'h1', name: 'Lakshmi', phone: '9876543210', role: 'MAID', status: 'ACTIVE', verified: true, suspendedReason: null, inside: true, lastVisitAt: '2026-10-30T04:00:00Z' },
  { id: 'h2', name: 'Ramesh', phone: null, role: 'DRIVER', status: 'SUSPENDED', verified: false, suspendedReason: 'Seen taking things', inside: false, lastVisitAt: null },
];
const gateHelpers = [
  { id: 'g1', name: 'Lakshmi', role: 'MAID', status: 'ACTIVE', verified: true, flatCodes: ['A-101', 'A-102'], inside: false },
  { id: 'g2', name: 'Ramesh', role: 'DRIVER', status: 'SUSPENDED', verified: false, flatCodes: ['A-101'], inside: false },
  { id: 'g3', name: 'Sita', role: 'COOK', status: 'ACTIVE', verified: false, flatCodes: ['B-201'], inside: true },
];
const gateVisits = [
  { id: 'v3', helperId: 'g3', name: 'Sita', role: 'COOK', flatCodes: ['B-201'], checkedInAt: '2026-10-30T04:00:00Z', checkedOutAt: null, method: 'GUARD', autoClosed: false },
  { id: 'v9', helperId: 'g1', name: 'Lakshmi', role: 'MAID', flatCodes: ['A-101'], checkedInAt: '2026-10-30T02:00:00Z', checkedOutAt: '2026-10-30T03:00:00Z', method: 'CODE', autoClosed: false },
];

const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === '/domestic-helpers/my') return { data: { data: mine } };
      if (url === '/domestic-helpers/h1/visits') return { data: { data: [{ id: 'x', helperId: 'h1', checkedInAt: '2026-10-30T04:00:00Z', checkedOutAt: null, method: 'CODE', autoClosed: false }] } };
      if (url === '/gate/helpers') return { data: { data: gateHelpers } };
      if (url === '/gate/helper-visits') return { data: { data: gateVisits } };
      if (url === '/societies/my') return { data: { data: { name: 'Green Park' } } };
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

import HouseholdHelpScreen from '../../app/(app)/household-help/index';
import { HelpPanel } from '@/components/gate/HelpPanel';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);
const serverError = (message: string, status = 409) => Object.assign(new Error(message), { response: { status, data: { message } } });
const inputByPlaceholder = (tree: any, p: string) => tree.root.findAllByType(TextInput).find((i: any) => i.props.placeholder === p);

async function mount(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({ data: { data: {} } });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
  (Share.share as jest.Mock).mockClear();
});

describe('Household help — my list', () => {
  it('shows who is inside, who is suspended and why', async () => {
    const text = textOf((await mount(<HouseholdHelpScreen />)).root);
    expect(text).toContain('1 inside now');
    expect(text).toContain('Inside now');
    expect(text).toContain('Suspended');
    expect(text).toContain('Seen taking things');
    expect(text).toContain('Maid · Verified by committee');
    expect(text).toContain('Has not come yet');
  });

  async function openAdd(tree: any) {
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Add someone' }).props.onPress(); });
  }

  it('will not add without a name, or with a number that cannot be right', async () => {
    const tree = await mount(<HouseholdHelpScreen />);
    await openAdd(tree);
    expect(buttons(tree, 'Add')[0].props.disabled).toBeTruthy();
    await act(async () => { inputByPlaceholder(tree, 'Name').props.onChangeText('Meena'); });
    expect(buttons(tree, 'Add')[0].props.disabled).toBeFalsy();
    await act(async () => { inputByPlaceholder(tree, 'Mobile number').props.onChangeText('12345'); });
    expect(buttons(tree, 'Add')[0].props.disabled).toBeTruthy();
    expect(textOf(tree.root)).toContain('does not look like a mobile number');
  });

  it('sends the person, shows the code once, and offers to share it', async () => {
    mockPost.mockResolvedValue({ data: { data: { helper: { id: 'n1', name: 'Meena' }, linked: false, code: 'K7QX-92MD' } } });
    const tree = await mount(<HouseholdHelpScreen />);
    await openAdd(tree);
    await act(async () => { inputByPlaceholder(tree, 'Name').props.onChangeText('  Meena '); });
    await act(async () => { inputByPlaceholder(tree, 'Mobile number').props.onChangeText('+91 98765 43211'); });
    await act(async () => { buttons(tree, 'Cook')[0].props.onPress(); });
    await act(async () => { buttons(tree, 'Add')[0].props.onPress(); });
    await flush();

    expect(mockPost).toHaveBeenCalledWith('/domestic-helpers', { name: 'Meena', role: 'COOK', phone: '+919876543211' });
    const text = textOf(tree.root);
    expect(text).toContain('K7QX-92MD');
    expect(text).toContain('shown only now');

    await act(async () => { buttons(tree, 'Share the code')[0].props.onPress(); });
    expect((Share.share as jest.Mock)).toHaveBeenCalledWith({ message: expect.stringContaining('K7QX-92MD') });
    expect((Share.share as jest.Mock).mock.calls[0][0].message).toContain('Green Park');

    // Closing the sheet forgets the code: it is nowhere to be seen afterwards.
    await act(async () => { buttons(tree, 'Done')[0].props.onPress(); });
    expect(textOf(tree.root)).not.toContain('K7QX-92MD');
  });

  it('links someone already on the register without a code, and says so', async () => {
    mockPost.mockResolvedValue({ data: { data: { helper: { id: 'h1', name: 'Lakshmi' }, linked: true } } });
    const tree = await mount(<HouseholdHelpScreen />);
    await openAdd(tree);
    await act(async () => { inputByPlaceholder(tree, 'Name').props.onChangeText('Lakshmi'); });
    await act(async () => { buttons(tree, 'Add')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Added', expect.stringContaining('already works in this society'));
    expect(textOf(tree.root)).not.toContain('Entry code for');
  });

  it('shows what the server said when adding fails', async () => {
    mockPost.mockRejectedValueOnce(serverError('This person is already on your list.'));
    const tree = await mount(<HouseholdHelpScreen />);
    await openAdd(tree);
    await act(async () => { inputByPlaceholder(tree, 'Name').props.onChangeText('Lakshmi'); });
    await act(async () => { buttons(tree, 'Add')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not add', 'This person is already on your list.');
  });

  it('opens a person to show their visits, makes a new code only after confirming, and removes only after confirming', async () => {
    mockPost.mockResolvedValue({ data: { data: { code: 'ZZZZ-2222', removed: true } } });
    const tree = await mount(<HouseholdHelpScreen />);
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Open Lakshmi' }).props.onPress(); });
    await flush();
    expect(textOf(tree.root)).toContain('Recent visits');
    expect(textOf(tree.root)).toContain('– inside');

    await act(async () => { buttons(tree, 'New code')[0].props.onPress(); });
    expect(mockPost).not.toHaveBeenCalled();
    const choices = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { choices.find((c) => c.text === 'Make new code')!.onPress!(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/domestic-helpers/h1/new-code');
    expect(textOf(tree.root)).toContain('ZZZZ-2222');
    await act(async () => { buttons(tree, 'Done')[0].props.onPress(); });

    mockPost.mockClear();
    await act(async () => { buttons(tree, 'Remove')[0].props.onPress(); });
    expect(mockPost).not.toHaveBeenCalled();
    const removeChoices = (Alert.alert as jest.Mock).mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await act(async () => { removeChoices.find((c) => c.text === 'Remove')!.onPress!(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/domestic-helpers/h1/remove');
  });
});

describe('Gate — household help', () => {
  const mountPanel = () => mount(<HelpPanel />);

  it('lists who is inside with a way to mark them as left, and offers "Let in" only to someone active and not already inside', async () => {
    const tree = await mountPanel();
    const text = textOf(tree.root);
    expect(text).toContain('Inside now (1)');
    expect(buttons(tree, 'Mark as left')).toHaveLength(1);
    expect(buttons(tree, 'Let in')).toHaveLength(1); // Lakshmi only: Ramesh is suspended, Sita is inside
    expect(text).toContain('Suspended by the committee. Do not let them in.');
  });

  it('shows flat numbers but no phone numbers', async () => {
    const text = textOf((await mountPanel()).root);
    expect(text).toContain('A-101, A-102');
    expect(text).not.toMatch(/\d{10}/);
  });

  it('lets someone in by their id, and records an exit by the visit id', async () => {
    mockPost.mockResolvedValue({ data: { data: { visit: {}, duplicate: false, alreadyInside: false, helper: {} } } });
    const tree = await mountPanel();
    await act(async () => { buttons(tree, 'Let in')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/helpers/g1/check-in', { clientRequestId: expect.any(String) });
    await act(async () => { buttons(tree, 'Mark as left')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/helper-visits/v3/check-out');
  });

  it('retries a dropped connection with the SAME request id, and a NEW one once the server answered', async () => {
    mockPost
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { data: { visit: {}, duplicate: false, alreadyInside: false, helper: {} } } })
      .mockResolvedValueOnce({ data: { data: { visit: {}, duplicate: false, alreadyInside: false, helper: {} } } });
    const tree = await mountPanel();
    for (let i = 0; i < 3; i++) {
      await act(async () => { buttons(tree, 'Let in')[0].props.onPress(); });
      await flush();
    }
    const [first, second, third] = mockPost.mock.calls.map((c) => c[1].clientRequestId);
    expect(second).toBe(first); // after a dropped connection
    expect(third).not.toBe(second); // after the server answered
  });

  it('shows what the server said when it refuses', async () => {
    mockPost.mockRejectedValueOnce(serverError('The committee has suspended this person. Do not let them in.', 403));
    const tree = await mountPanel();
    await act(async () => { buttons(tree, 'Let in')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not let them in', 'The committee has suspended this person. Do not let them in.');
  });

  async function openCode(tree: any) {
    await act(async () => { buttons(tree, 'Enter code')[0].props.onPress(); });
    return inputByPlaceholder(tree, 'XXXX-XXXX');
  }

  it('will not check an incomplete code, tidies what is typed, and sends it with a request id', async () => {
    mockPost.mockResolvedValue({ data: { data: { visit: {}, duplicate: false, alreadyInside: false, helper: { id: 'g1', name: 'Lakshmi', role: 'MAID', flatCodes: ['A-101', 'A-102'] } } } });
    const tree = await mountPanel();
    const input = await openCode(tree);
    await act(async () => { input.props.onChangeText('k7qx'); });
    expect(buttons(tree, 'Check code')[0].props.disabled).toBeTruthy();
    await act(async () => { input.props.onChangeText(' k7qx 92md '); });
    await act(async () => { buttons(tree, 'Check code')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/gate/helpers/scan', { code: 'K7QX-92MD', clientRequestId: expect.any(String) });
  });

  it('says who was let in and for which flats, so the guard can match the face to the name', async () => {
    mockPost.mockResolvedValue({ data: { data: { visit: {}, duplicate: false, alreadyInside: false, helper: { id: 'g1', name: 'Lakshmi', role: 'MAID', flatCodes: ['A-101', 'A-102'] } } } });
    const tree = await mountPanel();
    const input = await openCode(tree);
    await act(async () => { input.props.onChangeText('k7qx92md'); });
    await act(async () => { buttons(tree, 'Check code')[0].props.onPress(); });
    await flush();
    const text = textOf(tree.root);
    expect(text).toContain('Let them in');
    expect(text).toContain('Lakshmi · Maid');
    expect(text).toContain('Flat A-101, A-102');
  });

  it('says "Do not let them in" with the server’s reason when the code is refused', async () => {
    mockPost.mockRejectedValue(serverError('That code is not valid for this society.', 400));
    const tree = await mountPanel();
    const input = await openCode(tree);
    await act(async () => { input.props.onChangeText('k7qx92md'); });
    await act(async () => { buttons(tree, 'Check code')[0].props.onPress(); });
    await flush();
    const text = textOf(tree.root);
    expect(text).toContain('Do not let them in');
    expect(text).toContain('That code is not valid for this society.');
  });
});
