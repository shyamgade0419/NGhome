/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Funds tab: the bank split into the corpus, other funds and what is left (so the parts visibly add up),
 * a warning when the funds claim more than the bank holds, and adding an Other fund (and a corpus fund only
 * while there is none).
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSummary = jest.fn();
const mockList = jest.fn();
const mockCreate = jest.fn();

jest.mock('@/api/endpoints/accounts.api', () => ({
  accountsApi: { list: jest.fn(async () => [{ id: 'a1', name: 'Main', accountType: 'CURRENT', currentBalance: '425000.50' }]) },
  fundsApi: {
    summary: (...a: unknown[]) => mockSummary(...a),
    list: (...a: unknown[]) => mockList(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    contribute: jest.fn(),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import AccountsScreen from '../../app/(app)/admin/accounts/index';

jest.useRealTimers();
jest.setTimeout(60_000);
const until = async (cond: () => boolean, ms = 30_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const byLabel = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => n.props.accessibilityLabel === label);
const byText = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);

const picture = (over: Record<string, unknown> = {}) => ({
  bankTotal: '425000.50',
  accounts: [{ id: 'a1', name: 'Main', balance: '425000.50' }],
  corpus: { total: '250000.00', funds: [{ id: 'c', name: 'Corpus Fund', balance: '250000.00' }] },
  other: { total: '50000.25', funds: [{ id: 'f', name: 'Festival Fund', balance: '50000.25' }] },
  fundsTotal: '300000.25',
  generalBalance: '125000.25',
  fundsExceedBank: false,
  adds: true,
  ...over,
});
const fund = (over: Record<string, unknown>) => ({ id: 'x', name: 'X', kind: 'OTHER', currentBalance: '0', openingBalance: '0', description: null, isVisibleToResidents: false, ...over });

async function openFunds() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><AccountsScreen /></QueryClientProvider>);
  });
  await until(() => byText(tree, 'Funds').length > 0);
  await act(async () => { byText(tree, 'Funds')[0].props.onPress(); });
  await until(() => textOf(tree.root).includes('Where the money is'));
  return tree;
}

beforeEach(() => {
  mockSummary.mockReset().mockResolvedValue(picture());
  mockList.mockReset().mockResolvedValue([
    fund({ id: 'c', name: 'Corpus Fund', kind: 'CORPUS', currentBalance: '250000' }),
    fund({ id: 'f', name: 'Festival Fund', kind: 'OTHER', currentBalance: '50000.25' }),
  ]);
  mockCreate.mockReset().mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('Funds tab', () => {
  it('shows the bank split into corpus, each other fund and the rest, and says it adds up', async () => {
    const tree = await openFunds();
    const text = textOf(tree.root);
    expect(text).toContain('₹4,25,000.50');
    expect(text).toContain('Corpus fund');
    expect(text).toContain('₹2,50,000.00');
    expect(text).toContain('Festival Fund');
    expect(text).toContain('₹50,000.25');
    expect(text).toContain('Maintenance and general money');
    expect(text).toContain('₹1,25,000.25');
    expect(text).toContain('Adds up to the bank');
  });

  it('warns when the funds claim more than the bank holds', async () => {
    mockSummary.mockResolvedValue(picture({ generalBalance: '-10000.00', fundsExceedBank: true }));
    const tree = await openFunds();
    expect(textOf(tree.root)).toContain('Funds are more than the bank');
    expect(textOf(tree.root)).toContain('₹-10,000.00');
  });

  it('labels each fund as the corpus or another fund', async () => {
    const tree = await openFunds();
    await until(() => textOf(tree.root).includes('Add another fund'));
    const text = textOf(tree.root);
    expect(text).toContain('Corpus fund');
    expect(text).toContain('Other fund');
  });

  it('adds an Other fund, and offers a corpus fund only while there is none', async () => {
    const tree = await openFunds();
    await until(() => byLabel(tree, 'Add another fund').length === 1);
    await act(async () => { byLabel(tree, 'Add another fund')[0].props.onPress(); });
    await until(() => textOf(tree.root).includes('Kind of fund'));
    expect(byLabel(tree, 'Kind Corpus fund')).toHaveLength(0); // one already exists

    const nameInput = tree.root.findAllByType(TextInput).find((n: any) => n.props.placeholder === 'e.g. Festival Fund, Sinking Fund');
    await act(async () => { nameInput.props.onChangeText('Sinking Fund'); });
    await act(async () => { byText(tree, 'Create Fund')[0].props.onPress(); });
    await until(() => mockCreate.mock.calls.length === 1);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'OTHER', name: 'Sinking Fund' }));
  });

  it('offers the corpus kind when the society has none yet', async () => {
    mockList.mockResolvedValue([fund({ id: 'f', name: 'Festival Fund', kind: 'OTHER' })]);
    mockSummary.mockResolvedValue(picture({ corpus: { total: '0.00', funds: [] } }));
    const tree = await openFunds();
    await until(() => byLabel(tree, 'Add another fund').length === 1);
    await act(async () => { byLabel(tree, 'Add another fund')[0].props.onPress(); });
    await until(() => byLabel(tree, 'Kind Corpus fund').length === 1);
    await act(async () => { byLabel(tree, 'Kind Corpus fund')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('New Corpus Fund');
  });
});
