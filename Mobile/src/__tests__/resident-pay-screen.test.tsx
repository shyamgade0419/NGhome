/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident's Submit Payment screen: which bill the payment is recorded against.
 *
 * It used to look the bill up through the periods list, which only admins may read, so for a resident
 * the lookup failed, the payment went to the server with no bill, and it settled nothing. The bill now
 * comes from the resident's own bills — including the dues carried over from before NG Home.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockBills = jest.fn();
const mockSubmit = jest.fn();

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    getMyBills: (...a: unknown[]) => mockBills(...a),
    // The admin-only lookups the screen must no longer depend on: a resident would get a 403 here.
    getCurrentPeriod: jest.fn(async () => { throw new Error('403 Insufficient permissions'); }),
    getMyBill: jest.fn(async () => { throw new Error('should not be called'); }),
  },
}));
jest.mock('@/api/endpoints/payments.api', () => ({ paymentsApi: { submitPayment: (...a: unknown[]) => mockSubmit(...a) } }));
jest.mock('@/api/endpoints/societies.api', () => ({ societiesApi: { getSocietyConfig: jest.fn(async () => ({ additionalConfig: { upiId: 'soc@upi' } })) } }));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import SubmitPaymentScreen from '../../app/(app)/resident/payments/submit';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const byText = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);

const bill = (over: Record<string, unknown>) => ({
  id: 'b', invoiceNumber: 'INV-1', totalAmount: '1000', paidAmount: '0', pendingAmount: '1000', isPaid: false, isPublished: true,
  dueDate: '2026-10-10', billingPeriodId: 'p', billingPeriod: { id: 'p', periodYear: 2026, periodMonth: 10, kind: 'REGULAR' }, ...over,
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><SubmitPaymentScreen /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('Total Bill'));
  return tree;
}

beforeEach(() => {
  mockBills.mockReset();
  mockSubmit.mockReset().mockResolvedValue({ id: 'pay-1' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Submit Payment (resident)', () => {
  it('records the payment against the latest unpaid bill, with everything owed as the amount', async () => {
    mockBills.mockResolvedValue({
      data: [
        bill({ id: 'oct', pendingAmount: '1000' }),
        bill({ id: 'sep', pendingAmount: '500', totalAmount: '800', billingPeriodId: 'p0', billingPeriod: { id: 'p0', periodYear: 2026, periodMonth: 9, kind: 'REGULAR' } }),
      ],
      meta: {},
    });
    const tree = await mount();
    expect(textOf(tree.root)).toContain('₹1,500'); // owed: this month and the earlier one

    await act(async () => { byText(tree, 'Submit Payment')[0].props.onPress(); });
    await until(() => mockSubmit.mock.calls.length === 1);
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({
      maintenanceBillId: 'oct', billingPeriodId: 'p', amount: '1500.00', paymentMethod: 'UPI',
    });
  });

  it('can pay dues carried over from before NG Home when that is all the flat owes', async () => {
    mockBills.mockResolvedValue({
      data: [bill({ id: 'opening', invoiceNumber: 'OB-A-101', totalAmount: '12000', pendingAmount: '12000', billingPeriodId: 'op', billingPeriod: { id: 'op', periodYear: 1970, periodMonth: 1, kind: 'OPENING' } })],
      meta: {},
    });
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Opening balance');
    expect(textOf(tree.root)).not.toContain('1970');

    await act(async () => { byText(tree, 'Submit Payment')[0].props.onPress(); });
    await until(() => mockSubmit.mock.calls.length === 1);
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({ maintenanceBillId: 'opening', billingPeriodId: 'op', amount: '12000.00' });
  });

  it('falls back to the latest bill when everything is paid, so paying in advance still has a bill', async () => {
    mockBills.mockResolvedValue({ data: [bill({ id: 'paid', isPaid: true, pendingAmount: '0', paidAmount: '1000' })], meta: {} });
    const tree = await mount();
    await act(async () => { tree.root.findAllByType(TextInput).find((n: any) => n.props.placeholder === '0.00').props.onChangeText('500'); });
    expect(textOf(tree.root)).toContain('more than you owe is kept as an advance');

    await act(async () => { byText(tree, 'Submit Payment')[0].props.onPress(); });
    await until(() => mockSubmit.mock.calls.length === 1);
    expect(mockSubmit.mock.calls[0][0]).toMatchObject({ maintenanceBillId: 'paid', amount: '500' });
  });
});
