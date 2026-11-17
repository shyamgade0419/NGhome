/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Pay online" on the resident's payment screen: only shown when the society has it on; opens Razorpay's page for the amount
 * typed; then waits, asking the server where the payment stands, and tells the person plainly how it ended.
 */

import React from 'react';
import { Alert, Linking, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockAvailable = jest.fn();
const mockStart = jest.fn();
const mockStatus = jest.fn();
jest.mock('@/api/endpoints/onlinePayments.api', () => ({
  onlinePaymentsApi: {
    available: (...a: unknown[]) => mockAvailable(...a),
    start: (...a: unknown[]) => mockStart(...a),
    status: (...a: unknown[]) => mockStatus(...a),
  },
}));

import { PayOnlineCard } from '@/components/payments/PayOnlineCard';
import { Button } from '@/components/ui/Button';
import { cleanAmount, isOpen, outcomeMessage } from '@/utils/onlinePayments';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any) => tree.root.findAllByType(Button);
const trees: any[] = [];
async function mount(onPaid = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><PayOnlineCard maintenanceBillId="bill-1" owed="2500.00" onPaid={onPaid} /></QueryClientProvider>); });
  trees.push(tree);
  return { tree, onPaid };
}

beforeEach(() => {
  mockAvailable.mockReset().mockResolvedValue({ enabled: true });
  mockStart.mockReset().mockResolvedValue({ id: 'ord-1', outcome: 'WAITING', amount: '2500', paidAt: null, url: 'https://rzp.io/i/abc' });
  mockStatus.mockReset().mockResolvedValue({ id: 'ord-1', outcome: 'WAITING', amount: '2500', paidAt: null, url: null });
  // Both are already mocks in React Native's jest setup, so spyOn hands back the same one: clear what earlier tests recorded.
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true as any);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('the amount and the messages', () => {
  it('accepts rupees and paise only', () => {
    expect(cleanAmount('1500')).toBe('1500');
    expect(cleanAmount(' 1,500.50 ')).toBe('1500.50');
    for (const bad of ['', '0', '0.00', '-3', 'abc', '10.999', '1e3']) expect(cleanAmount(bad)).toBeNull();
  });
  it('says plainly how a payment ended, and nothing while it is open', () => {
    expect(isOpen('WAITING')).toBe(true);
    expect(isOpen('PAID')).toBe(false);
    expect(outcomeMessage('WAITING')).toBeNull();
    expect(outcomeMessage('PAID')).toMatchObject({ ok: true, title: 'Payment received' });
    expect(outcomeMessage('NEEDS_REVIEW')?.body).toContain('confirm it');
    expect(outcomeMessage('EXPIRED')).toMatchObject({ ok: false });
    expect(outcomeMessage('FAILED')?.body).toContain('comes back to you');
  });
});

describe('Pay online card', () => {
  it('is not there at all when the society has not switched it on', async () => {
    mockAvailable.mockResolvedValue({ enabled: false });
    const { tree } = await mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(tree.toJSON()).toBeNull();
  });

  it('starts with what is owed, and opens Razorpay\'s page for the amount typed', async () => {
    const { tree } = await mount();
    await until(() => textOf(tree.root).includes('Pay online'));
    const field = tree.root.findAllByType(TextInput)[0];
    expect(field.props.value).toBe('2500.00');
    await act(async () => { field.props.onChangeText('1,500.50'); });
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await until(() => mockStart.mock.calls.length === 1);
    expect(mockStart).toHaveBeenCalledWith({ maintenanceBillId: 'bill-1', amount: '1500.50' });
    await until(() => (Linking.openURL as jest.Mock).mock.calls.length === 1);
    expect(Linking.openURL).toHaveBeenCalledWith('https://rzp.io/i/abc');
    await until(() => textOf(tree.root).includes('Waiting for your payment'));
  });

  it('refuses an amount that is not a positive sum before asking the server', async () => {
    const { tree } = await mount();
    await until(() => textOf(tree.root).includes('Pay online'));
    await act(async () => { tree.root.findAllByType(TextInput)[0].props.onChangeText('abc'); });
    await act(async () => { buttons(tree)[0].props.onPress(); });
    expect(mockStart).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Amount');
  });

  it('tells the person when the payment could not be started, in the server\'s words, and stays ready to try again', async () => {
    mockStart.mockRejectedValue({ response: { data: { message: 'That is more than this flat can pay at once' } } });
    const { tree } = await mount();
    await until(() => textOf(tree.root).includes('Pay online'));
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0]).toEqual(['Could not start the payment', 'That is more than this flat can pay at once']);
    expect((Linking.openURL as jest.Mock).mock.calls).toEqual([]);
    expect(textOf(tree.root)).not.toContain('Waiting for your payment');
  });

  it('on "Check now", says the payment was received and lets the screen refresh, once', async () => {
    const { tree, onPaid } = await mount();
    await until(() => textOf(tree.root).includes('Pay online'));
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Waiting for your payment'));
    mockStatus.mockResolvedValue({ id: 'ord-1', outcome: 'PAID', amount: '2500', paidAt: '2046-01-01T00:00:00Z', url: null });
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await act(async () => { buttons(tree)[0]?.props.onPress?.(); });
    await until(() => onPaid.mock.calls.length === 1);
    expect(Alert.alert).toHaveBeenCalledWith('Payment received', expect.stringContaining('bill is updated'));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('says so when the payment page expired, and does not refresh the bills', async () => {
    const { tree, onPaid } = await mount();
    await until(() => textOf(tree.root).includes('Pay online'));
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Waiting for your payment'));
    mockStatus.mockResolvedValue({ id: 'ord-1', outcome: 'EXPIRED', amount: '2500', paidAt: null, url: null });
    await act(async () => { buttons(tree)[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Payment page expired'));
    expect(onPaid).not.toHaveBeenCalled();
  });
});
