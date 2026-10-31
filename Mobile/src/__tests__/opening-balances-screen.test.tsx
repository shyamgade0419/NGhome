/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Opening Balances screen, rendered: the flats and what each owes, searching, opening one to enter
 * an amount, and what is sent. A flat that has been paid against is shown locked and cannot be edited.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockSave = jest.fn();
const mockCorrect = jest.fn();
const mockPick = jest.fn();
const mockRead = jest.fn();
let mockIsAdmin = true;

jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: {
    getOpeningBalances: (...a: unknown[]) => mockGet(...a),
    saveOpeningBalances: (...a: unknown[]) => mockSave(...a),
    correctOpeningBalance: (...a: unknown[]) => mockCorrect(...a),
  },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: (...a: unknown[]) => mockRead(...a) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import OpeningBalancesScreen from '../../app/(app)/admin/opening-balances/index';

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
const byText = (tree: any, label: string) => pressables(tree).filter((n: any) => textOf(n) === label);
const inputByLabel = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);

const flat = (over: Record<string, unknown>) => ({
  flatId: 'f', flatCode: 'A-101', residentName: null, amount: null, paidAmount: '0', pendingAmount: '0', note: null, locked: null, ...over,
});
const data = (over: Record<string, unknown> = {}) => ({
  asOfDate: '2026-03-31T00:00:00.000Z',
  startedBilling: false,
  totals: { flats: 3, withBalance: 2, opening: '15000', paid: '3000', pending: '12000' },
  rows: [
    flat({ flatId: 'f1', flatCode: 'A-101', residentName: 'Arjun Mehta', amount: '12000', pendingAmount: '12000', note: 'Paper ledger' }),
    flat({ flatId: 'f2', flatCode: 'A-102', residentName: 'Kavya Reddy' }),
    flat({ flatId: 'f3', flatCode: 'A-103', residentName: 'Imran Sheikh', amount: '3000', paidAmount: '3000', pendingAmount: '0', locked: 'A payment has been recorded against it, so it can no longer be changed.' }),
  ],
  ...over,
});
const saved = (summary: Record<string, number>, results: any[] = []) => ({
  dryRun: false, asOfDate: '2026-03-31T00:00:00.000Z',
  summary: { created: 0, updated: 0, removed: 0, unchanged: 0, rejected: 0, ...summary }, results,
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><OpeningBalancesScreen /></QueryClientProvider>);
  });
  await until(() => textOf(tree.root).includes('A-101'));
  return tree;
}

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue(data());
  mockSave.mockReset().mockResolvedValue(saved({ created: 1 }));
  mockCorrect.mockReset().mockResolvedValue({ flatCode: 'A-103', previous: '3000', amount: '2000', movedToAdvance: '1000' });
  mockPick.mockReset().mockResolvedValue({ canceled: true });
  mockRead.mockReset().mockResolvedValue('');
  mockIsAdmin = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Opening Balances screen', () => {
  it('lists every flat with what it owes, and what is still to pay', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('2 of 3');
    expect(text).toContain('₹12,000');
    expect(text).toContain('Arjun Mehta');
    expect(text).toContain('Paper ledger');
    expect(text).toContain('Add'); // A-102 has none yet
    expect(text).toContain('Cleared'); // A-103 is paid
  });

  it('warns when a month has already been billed', async () => {
    mockGet.mockResolvedValue(data({ startedBilling: true }));
    const tree = await mount();
    expect(textOf(tree.root)).toContain('A month has already been billed');
  });

  it('finds a flat by code or resident', async () => {
    const tree = await mount();
    await act(async () => { inputByLabel(tree, 'Find a flat or resident').props.onChangeText('kavya'); });
    const text = textOf(tree.root);
    expect(text).toContain('A-102');
    expect(text).not.toContain('A-101');
  });

  it('sends the amount and note typed for one flat, then says it was saved', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-102')[0].props.onPress(); });
    await until(() => !!inputByLabel(tree, 'Opening balance'));

    await act(async () => { inputByLabel(tree, 'Opening balance').props.onChangeText('₹ 8,500'); });
    await act(async () => { inputByLabel(tree, 'Note').props.onChangeText('Ledger p.14'); });
    await act(async () => { byText(tree, 'Save')[0].props.onPress(); });

    await until(() => mockSave.mock.calls.length === 1);
    expect(mockSave).toHaveBeenCalledWith({ asOfDate: '2026-03-31', rows: [{ flatCode: 'A-102', amount: 8500, note: 'Ledger p.14' }] });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Saved'));
  });

  it('will not save something that is not an amount, or nothing at all', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-102')[0].props.onPress(); });
    await until(() => !!inputByLabel(tree, 'Opening balance'));

    expect(byText(tree, 'Save')[0].props.disabled).toBe(true); // empty
    await act(async () => { inputByLabel(tree, 'Opening balance').props.onChangeText('abc'); });
    expect(textOf(tree.root)).toContain('That is not an amount.');
    expect(byText(tree, 'Save')[0].props.disabled).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('removes a balance by sending zero, after asking', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-101')[0].props.onPress(); });
    await until(() => byText(tree, 'Remove').length > 0);
    expect((inputByLabel(tree, 'Opening balance')).props.value).toBe('12000');

    await act(async () => { byText(tree, 'Remove')[0].props.onPress(); });
    const confirm = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Remove balance');
    expect(confirm[1]).toContain('A-101');
    await act(async () => { confirm[2].find((b: any) => b.text === 'Remove').onPress(); });

    await until(() => mockSave.mock.calls.length === 1);
    expect(mockSave.mock.calls[0][0].rows).toEqual([{ flatCode: 'A-101', amount: 0, note: 'Paper ledger' }]);
  });

  it('shows a flat that has been paid against as locked, with the reason and no way to edit', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-103')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('can no longer be changed'));
    expect(inputByLabel(tree, 'Opening balance')).toBeUndefined();
    expect(byText(tree, 'Save')).toHaveLength(0);
  });

  it('lets the admin correct a locked balance, with a reason, and says what became the advance', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-103')[0].props.onPress(); });
    await until(() => byText(tree, 'Correct the amount').length > 0);
    await act(async () => { byText(tree, 'Correct the amount')[0].props.onPress(); });
    await until(() => !!inputByLabel(tree, 'Corrected amount'));

    expect(byText(tree, 'Correct balance')[0].props.disabled).toBe(true); // nothing entered yet
    await act(async () => { inputByLabel(tree, 'Corrected amount').props.onChangeText('2000'); });
    await act(async () => { inputByLabel(tree, 'Correction reason').props.onChangeText('Ledger page 14 was misread'); });
    expect(byText(tree, 'Correct balance')[0].props.disabled).toBe(false);
    await act(async () => { byText(tree, 'Correct balance')[0].props.onPress(); });

    await until(() => mockCorrect.mock.calls.length === 1);
    expect(mockCorrect).toHaveBeenCalledWith('f3', { amount: 2000, reason: 'Ledger page 14 was misread' });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Corrected'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Corrected')[1]).toContain('₹1,000');
  });

  it('does not offer the correction to anyone but the admin', async () => {
    mockIsAdmin = false;
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-103')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('can no longer be changed'));
    expect(byText(tree, 'Correct the amount')).toHaveLength(0);
  });

  it("loads balances from a CSV file: checks it first, shows problems with the file's own row numbers, then saves", async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/dues.csv', name: 'dues.csv' }] });
    mockRead.mockResolvedValue('Flat,Amount,Note\nA-102,"8,500",Ledger p.14\nZ-9,100,\nA-101,xyz,\nA-103,,\n');
    mockSave.mockImplementation(async (body: any) =>
      body.dryRun
        ? { dryRun: true, asOfDate: '2026-03-31', summary: { created: 1, updated: 0, removed: 0, unchanged: 0, rejected: 1 }, results: [
            { row: 1, flatCode: 'A-102', flatId: 'f2', action: 'CREATE', amount: '8500', previous: null, note: 'Ledger p.14', message: null },
            { row: 2, flatCode: 'Z-9', flatId: null, action: 'REJECTED', amount: '0', previous: null, note: null, message: 'No flat "Z-9" in this society.' },
          ] }
        : saved({ created: 1 }),
    );
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Load balances from a file')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('1 to save'));

    // The server was asked to check the two rows that could be read, without saving.
    expect(mockSave.mock.calls[0][0]).toEqual({
      asOfDate: '2026-03-31', dryRun: true,
      rows: [{ flatCode: 'A-102', amount: 8500, note: 'Ledger p.14' }, { flatCode: 'Z-9', amount: 100 }],
    });
    const text = textOf(tree.root);
    expect(text).toContain('2 with a problem');
    expect(text).toContain('Row 3 — Z-9: No flat "Z-9"'); // the file's line 3, not the second row sent
    expect(text).toContain('Row 4 — A-101: "xyz" is not an amount.');

    await act(async () => { byText(tree, 'Save 1 balance')[0].props.onPress(); });
    await until(() => mockSave.mock.calls.length === 2);
    expect(mockSave.mock.calls[1][0]).toEqual({
      asOfDate: '2026-03-31',
      rows: [{ flatCode: 'A-102', amount: 8500, note: 'Ledger p.14' }, { flatCode: 'Z-9', amount: 100 }],
    });
  });

  it('says so when the file is not one it can read', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/x.csv', name: 'x.csv' }] });
    mockRead.mockResolvedValue('Name,Phone\nArjun,9000000000\n');
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Load balances from a file')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Cannot read this file'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Cannot read this file')[1]).toContain('Flat column');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('tells the person when the server refuses a flat', async () => {
    mockSave.mockResolvedValue(saved({ rejected: 1 }, [{ row: 1, flatCode: 'A-102', action: 'REJECTED', message: 'No flat "A-102" in this society.' }]));
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Opening balance for A-102')[0].props.onPress(); });
    await until(() => !!inputByLabel(tree, 'Opening balance'));
    await act(async () => { inputByLabel(tree, 'Opening balance').props.onChangeText('100'); });
    await act(async () => { byText(tree, 'Save')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Not saved'));
    const alert = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Not saved');
    expect(alert[1]).toContain('No flat "A-102"');
  });
});
