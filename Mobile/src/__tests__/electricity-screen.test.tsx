/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * My electricity: the saved connection(s), the monthly reminder, adding one from the list or a company of one's own, and paying on
 * the company's own website. What matters: the number is tidied before it is sent, nothing is saved until the form is complete,
 * the reminder can be switched off, removing asks first, and only a plain https link is ever opened.
 */

import React from 'react';
import { Alert, Linking, Switch, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

let mockConnections: any[];
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/api/endpoints/utilities.api', () => ({
  utilitiesApi: {
    providers: async () => ({
      defaultReminderDay: 8,
      electricity: [
        { code: 'TGSPDCL', name: 'TGSPDCL (Southern Power, Telangana)', region: 'Telangana', url: 'https://tgsouthernpower.org' },
        { code: 'BESCOM', name: 'BESCOM (Bengaluru)', region: 'Karnataka', url: 'https://bescom.karnataka.gov.in' },
      ],
    }),
    mine: async () => mockConnections,
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
}));

import ElectricityScreen from '../../app/(app)/electricity/index';
import { Button } from '@/components/ui/Button';
import { clampDay, dateText, isHttps, isValidNumber, ordinal, tidyNumber } from '@/utils/utilities';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const byLabel = (tree: any, label: string) => tree.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const input = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
const buttonNamed = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === Button && n.props.label === label)[0];
const trees: any[] = [];
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ElectricityScreen /></QueryClientProvider>); });
  trees.push(tree);
  await until(() => !textOf(tree.root).includes('Loading'));
  return tree;
}

const saved = {
  id: 'c1', providerCode: 'TGSPDCL', providerName: 'TGSPDCL (Southern Power, Telangana)', providerUrl: 'https://tgsouthernpower.org',
  consumerNumber: 'AB 1234 5678', nickname: 'Flat meter', reminderDay: 8, remindersOn: true, nextReminder: '2026-12-08',
};

beforeEach(() => {
  mockConnections = [];
  mockCreate.mockReset().mockResolvedValue(saved);
  mockUpdate.mockReset().mockResolvedValue(saved);
  mockRemove.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockClear().mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true as any);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('the helpers', () => {
  it('tidies a number the way the server keeps it, and checks it as printed on a bill', () => {
    expect(tidyNumber('  ab  1234 5678 ')).toBe('AB 1234 5678');
    expect(isValidNumber('AB 1234 5678')).toBe(true);
    for (const bad of ['', '12', '<b>1</b>', ' ', 'x'.repeat(26)]) expect(isValidNumber(bad)).toBe(false);
  });
  it('writes the day as an ordinal, and keeps it to days every month has', () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '8th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th']);
    expect(clampDay(0)).toBe(1);
    expect(clampDay(31)).toBe(28);
  });
  it('writes a date out, and opens only plain https links', () => {
    expect(dateText('2026-12-08')).toBe('8 Dec 2026');
    expect(isHttps('https://tgsouthernpower.org')).toBe(true);
    for (const bad of ['http://x.example', 'javascript:alert(1)', 'tel:100', '', null, undefined]) expect(isHttps(bad as any)).toBe(false);
  });
});

describe('Electricity screen', () => {
  it('says so when nothing is saved yet, and that a reminder comes on the 8th', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('No connection saved yet');
    expect(text).toContain('8th of every month');
    expect(text).toContain('does not fetch your bill');
  });

  it('shows a saved connection with its reminder and when the next one is', async () => {
    mockConnections = [saved];
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('Flat meter');
    expect(text).toContain('Consumer no. AB 1234 5678');
    expect(text).toContain('Remind me on the 8th of every month');
    expect(text).toContain('Next reminder: 8 Dec 2026');
  });

  it('cannot be saved until a company and a real number are chosen, then sends the number tidied', async () => {
    const tree = await mount();
    await act(async () => { buttonNamed(tree, 'Add my connection').props.onPress(); });
    expect(buttonNamed(tree, 'Save and remind me').props.disabled).toBe(true);
    await act(async () => { byLabel(tree, 'TGSPDCL (Southern Power, Telangana)').props.onPress(); });
    expect(buttonNamed(tree, 'Save and remind me').props.disabled).toBe(true); // still no number
    await act(async () => { input(tree, 'Consumer number').props.onChangeText('  ab  1234 5678 '); });
    expect(buttonNamed(tree, 'Save and remind me').props.disabled).toBe(false);
    await act(async () => { buttonNamed(tree, 'Save and remind me').props.onPress(); });
    await until(() => mockCreate.mock.calls.length === 1);
    expect(mockCreate).toHaveBeenCalledWith({ providerCode: 'TGSPDCL', consumerNumber: 'AB 1234 5678', nickname: '', reminderDay: 8 });
  });

  it('takes a company of one\'s own, and needs its name', async () => {
    const tree = await mount();
    await act(async () => { buttonNamed(tree, 'Add my connection').props.onPress(); });
    await act(async () => { byLabel(tree, 'Other').props.onPress(); });
    await act(async () => { input(tree, 'Consumer number').props.onChangeText('ST-0042'); });
    expect(buttonNamed(tree, 'Save and remind me').props.disabled).toBe(true); // no name yet
    await act(async () => { input(tree, 'Company name').props.onChangeText('Small Town Power'); });
    await act(async () => { input(tree, 'Company website').props.onChangeText('https://smalltownpower.example/pay'); });
    await act(async () => { buttonNamed(tree, 'Save and remind me').props.onPress(); });
    await until(() => mockCreate.mock.calls.length === 1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ providerCode: 'OTHER', providerName: 'Small Town Power', providerUrl: 'https://smalltownpower.example/pay', consumerNumber: 'ST-0042' });
  });

  it('chooses the reminder day with the plus and minus buttons, never past the 28th', async () => {
    const tree = await mount();
    await act(async () => { buttonNamed(tree, 'Add my connection').props.onPress(); });
    expect(textOf(tree.root)).toContain('Remind me on the 8th of every month');
    await act(async () => { byLabel(tree, 'Later reminder day').props.onPress(); });
    expect(textOf(tree.root)).toContain('9th');
    for (let i = 0; i < 25; i += 1) await act(async () => { byLabel(tree, 'Later reminder day').props.onPress(); });
    expect(textOf(tree.root)).toContain('28th');
  });

  it('tells the person why when it could not be saved, and keeps the sheet open', async () => {
    mockCreate.mockRejectedValue({ response: { data: { message: 'That consumer number is already saved for your flat.' } } });
    const tree = await mount();
    await act(async () => { buttonNamed(tree, 'Add my connection').props.onPress(); });
    await act(async () => { byLabel(tree, 'BESCOM (Bengaluru)').props.onPress(); });
    await act(async () => { input(tree, 'Consumer number').props.onChangeText('BE-1001'); });
    await act(async () => { buttonNamed(tree, 'Save and remind me').props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0]).toEqual(['Could not save', 'That consumer number is already saved for your flat.']);
    expect(textOf(tree.root)).toContain('Add your connection');
  });

  it('switches a reminder off', async () => {
    mockConnections = [saved];
    const tree = await mount();
    await act(async () => { tree.root.findByType(Switch).props.onValueChange(false); });
    await until(() => mockUpdate.mock.calls.length === 1);
    expect(mockUpdate).toHaveBeenCalledWith('c1', { remindersOn: false });
  });

  it('asks before removing a connection, and removes it only when told to', async () => {
    mockConnections = [saved];
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Remove Flat meter').props.onPress(); });
    const call = (Alert.alert as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('Remove this connection?');
    expect(mockRemove).not.toHaveBeenCalled();
    await act(async () => { call[2].find((b: any) => b.text === 'Remove').onPress(); });
    await until(() => mockRemove.mock.calls.length === 1);
    expect(mockRemove).toHaveBeenCalledWith('c1');
  });

  it('opens the company\'s own website to pay, and says so when there is none to open', async () => {
    mockConnections = [saved, { ...saved, id: 'c2', providerCode: 'OTHER', providerName: 'Small Town Power', providerUrl: null, nickname: null, consumerNumber: 'ST-1' }];
    const tree = await mount();
    const payButtons = tree.root.findAll((n: any) => n.type === Button && n.props.label === "Pay on the company's website");
    await act(async () => { payButtons[0].props.onPress(); });
    expect(Linking.openURL).toHaveBeenCalledWith('https://tgsouthernpower.org');
    await act(async () => { payButtons[1].props.onPress(); });
    expect((Linking.openURL as jest.Mock).mock.calls).toHaveLength(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('No website saved');
  });

  it('shows reminders as off when they are', async () => {
    mockConnections = [{ ...saved, remindersOn: false, nextReminder: null }];
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Reminders are off');
  });
});
