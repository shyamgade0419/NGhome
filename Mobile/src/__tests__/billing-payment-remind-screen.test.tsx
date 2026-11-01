/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The admin marking a flat's bill as paid, and reminding the flats that have not paid: what is sent, what is refused
 * before sending, and who each reminder is addressed to.
 */

import React from 'react';
import { Alert, Linking, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRecord = jest.fn();
const mockSendReminders = jest.fn();

jest.mock('@/api/endpoints/payments.api', () => ({
  paymentsApi: { recordPayment: (...a: unknown[]) => mockRecord(...a) },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: {
    list: jest.fn(async () => [
      { id: 'a1', name: 'Main Account', currentBalance: '1000' },
      { id: 'a2', name: 'Petty Cash', currentBalance: '50' },
    ]),
  },
}));
jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    getReminders: jest.fn(async () => [
      { billId: 'b1', flatId: 'f1', flatCode: 'A-101', userId: 'u1', residentName: 'Tara Tenant', residentPhone: '9876543210', residentType: 'TENANT', pendingAmount: '3500', message: 'Dear Tara, pay Rs 3,500' },
      { billId: 'b2', flatId: 'f2', flatCode: 'A-102', userId: 'u2', residentName: 'Omar Owner', residentPhone: null, residentType: 'OWNER', pendingAmount: '2000', message: 'Dear Omar, pay Rs 2,000' },
      { billId: 'b3', flatId: 'f3', flatCode: 'A-103', userId: null, residentName: null, residentPhone: null, residentType: null, pendingAmount: '1000', message: 'Dear Resident' },
    ]),
    sendReminders: (...a: unknown[]) => mockSendReminders(...a),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import { RecordPaymentModal } from '@/components/billing/RecordPaymentModal';
import { RemindAllModal } from '@/components/billing/RemindAllModal';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const pressables = (tree: any) => tree.root.findAllByType(TouchableOpacity);
const byLabel = (tree: any, label: string) => pressables(tree).filter((n: any) => n.props.accessibilityLabel === label);
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);
const pressButton = async (tree: any, label: string) => {
  const b = tree.root.findAll((n: any) => n.props.label === label && typeof n.props.onPress === 'function')[0];
  await act(async () => { b.props.onPress(); });
};

const bill = { id: 'b1', flatCode: 'A-101', invoiceNumber: 'INV-1', pendingAmount: '3500', totalAmount: '4000' } as any;

async function mountPay(onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><RecordPaymentModal bill={bill} periodId="p1" onClose={onClose} /></QueryClientProvider>);
  });
  await until(() => byLabel(tree, 'Into Main Account').length === 1);
  trees.push(tree);
  return { tree, onClose };
}

const trees: any[] = [];
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

beforeEach(() => {
  mockRecord.mockReset().mockResolvedValue({});
  mockSendReminders.mockReset().mockResolvedValue({ unpaid: 3, sent: 2, withoutResident: ['A-103'] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Marking a flat as paid', () => {
  it('starts on what is still owed, and records it with the account, method and date chosen', async () => {
    const { tree, onClose } = await mountPay();
    expect(input(tree, 'Amount').props.value).toBe('3500');
    await act(async () => { byLabel(tree, 'Into Main Account')[0].props.onPress(); });
    await act(async () => { byLabel(tree, 'Paid by Cheque')[0].props.onPress(); });
    await act(async () => { input(tree, 'Date paid').props.onChangeText('2026-10-05'); });
    await act(async () => { input(tree, 'Reference').props.onChangeText('CHQ 123'); });
    await act(async () => { input(tree, 'Note').props.onChangeText('Handed to the secretary'); });
    await pressButton(tree, 'Mark as paid');

    await until(() => mockRecord.mock.calls.length === 1);
    expect(mockRecord).toHaveBeenCalledWith({
      maintenanceBillId: 'b1', accountId: 'a1', amount: 3500, paymentDate: '2026-10-05', paymentMethod: 'CHEQUE',
      utrNumber: 'CHQ 123', notes: 'Handed to the secretary',
    });
    await until(() => onClose.mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Marked as paid');
  });

  it('sends only what was filled in', async () => {
    const { tree } = await mountPay();
    await act(async () => { byLabel(tree, 'Into Petty Cash')[0].props.onPress(); });
    await act(async () => { input(tree, 'Amount').props.onChangeText('1000'); });
    await pressButton(tree, 'Mark as paid');
    await until(() => mockRecord.mock.calls.length === 1);
    const sent = mockRecord.mock.calls[0][0];
    expect(sent).toMatchObject({ accountId: 'a2', amount: 1000, paymentMethod: 'CASH' });
    expect(sent).not.toHaveProperty('utrNumber');
    expect(sent).not.toHaveProperty('notes');
  });

  it('refuses before sending: no account, no amount, or a date in the future', async () => {
    const { tree } = await mountPay();
    await pressButton(tree, 'Mark as paid');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/account/);

    await act(async () => { byLabel(tree, 'Into Main Account')[0].props.onPress(); });
    await act(async () => { input(tree, 'Amount').props.onChangeText(''); });
    await pressButton(tree, 'Mark as paid');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/amount greater than zero/);

    await act(async () => { input(tree, 'Amount').props.onChangeText('100'); });
    await act(async () => { input(tree, 'Date paid').props.onChangeText('2999-01-01'); });
    await pressButton(tree, 'Mark as paid');
    expect((Alert.alert as jest.Mock).mock.calls.pop()[1]).toMatch(/not in the future/);

    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('shows the server reason when it refuses, and stays open', async () => {
    mockRecord.mockRejectedValue({ response: { data: { message: 'This bill is already paid.' } } });
    const { tree, onClose } = await mountPay();
    await act(async () => { byLabel(tree, 'Into Main Account')[0].props.onPress(); });
    await pressButton(tree, 'Mark as paid');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Could not record it'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Could not record it')[1]).toBe('This bill is already paid.');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Reminding the unpaid flats', () => {
  async function mountRemind() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let tree!: any;
    await act(async () => {
      tree = TestRenderer.create(<QueryClientProvider client={qc}><RemindAllModal periodId="p1" onClose={jest.fn()} /></QueryClientProvider>);
    });
    await until(() => textOf(tree.root).includes('A-101'));
    trees.push(tree);
    return tree;
  }

  it('lists each unpaid flat with who it goes to — tenant or owner — and what is owed', async () => {
    const tree = await mountRemind();
    const text = textOf(tree.root);
    expect(text).toContain('3 unpaid');
    expect(text).toContain('Tara Tenant · Tenant');
    expect(text).toContain('Omar Owner · Owner');
    expect(text).toContain('No resident registered');
    expect(text).toContain('₹3,500');
  });

  it('opens WhatsApp on that person\'s number with the templated message', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const tree = await mountRemind();
    await act(async () => { byLabel(tree, 'WhatsApp Flat A-101')[0].props.onPress(); });
    expect(open).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent('Dear Tara, pay Rs 3,500')}`);
  });

  it('lets the admin pick the contact when a flat has no saved number', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const tree = await mountRemind();
    await act(async () => { byLabel(tree, 'WhatsApp Flat A-102')[0].props.onPress(); });
    expect(open).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent('Dear Omar, pay Rs 2,000')}`);
  });

  it('notifies every unpaid flat in the app after a confirmation, and says who has no resident', async () => {
    const tree = await mountRemind();
    await pressButton(tree, 'Notify all 3 in the app');
    const confirm = (Alert.alert as jest.Mock).mock.calls.pop();
    expect(confirm[0]).toBe('Notify all unpaid flats');
    expect(mockSendReminders).not.toHaveBeenCalled(); // not until confirmed
    await act(async () => { confirm[2].find((b: any) => b.text === 'Send').onPress(); });
    await until(() => mockSendReminders.mock.calls.length === 1);
    expect(mockSendReminders).toHaveBeenCalledWith('p1');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Reminders sent'));
    const done = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Reminders sent');
    expect(done[1]).toContain('Sent to 2 of 3 unpaid flats');
    expect(done[1]).toContain('A-103');
  });
});
