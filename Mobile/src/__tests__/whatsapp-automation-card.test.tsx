/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The admin's WhatsApp automation card: what it says about the connection, what it saves, and the test message.
 */

import React from 'react';
import { Alert, Switch, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockStatus: any;
let mockIsAdmin = true;
const mockSave = jest.fn();
const mockTest = jest.fn();

jest.mock('@/api/endpoints/whatsapp.api', () => ({
  whatsappApi: {
    status: async () => mockStatus,
    messages: async () => [
      { id: 'm1', kind: 'REMINDER', toPhone: '919876543210', status: 'SENT', attempts: 1, lastError: null, createdAt: '', sentAt: '' },
      { id: 'm2', kind: 'FINE_IMPOSED', toPhone: '919876500000', status: 'FAILED', attempts: 3, lastError: 'nope', createdAt: '', sentAt: null },
    ],
    saveSettings: (...a: unknown[]) => mockSave(...a),
    test: (...a: unknown[]) => mockTest(...a),
  },
}));
jest.mock('@/hooks/useAuth', () => ({ useIsSocietyAdmin: () => mockIsAdmin }));

import { WhatsappAutomationCard } from '@/components/billing/WhatsappAutomationCard';
import { parseReminderDays } from '@/utils/reminders';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const input = (tree: any, label: string) => tree.root.findAllByType(TextInput).find((n: any) => n.props.accessibilityLabel === label);
const pressButton = async (tree: any, label: string) => {
  const b = tree.root.findAll((n: any) => n.props.label === label && typeof n.props.onPress === 'function')[0];
  await act(async () => { b.props.onPress(); });
};

const trees: any[] = [];
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><WhatsappAutomationCard /></QueryClientProvider>);
  });
  trees.push(tree);
  await until(() => textOf(tree.root).includes('Latest messages'));
  return tree;
}

beforeEach(() => {
  mockIsAdmin = true;
  mockStatus = { configured: true, allowed: true, enabled: false, reminderDays: [5, 10], session: 'ready', sendingFrom: '919000011111', problem: null, queued: 2, sentToday: 5, failedThisWeek: 1 };
  mockSave.mockReset().mockResolvedValue(undefined);
  mockTest.mockReset().mockResolvedValue({ sent: true });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('parseReminderDays', () => {
  it('keeps real days of every month, once each, in order', () => {
    expect(parseReminderDays('10, 5; 5 0 29 x 3')).toEqual([3, 5, 10]);
    expect(parseReminderDays('')).toEqual([]);
  });
});

describe('WhatsApp automation card', () => {
  it('says it is connected, from which number, and what is waiting', async () => {
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('Connected — sending from +919000011111');
    expect(text).toContain('5 sent today, 2 waiting, 1 failed this week');
    expect(text).toContain('Reminder · +919876543210');
    expect(text).toContain('Late fine');
    expect(text).toContain('Failed');
  });

  it('says plainly when the server has no WhatsApp connection, and will not let it be switched on', async () => {
    mockStatus = { ...mockStatus, configured: false, session: null, sendingFrom: null };
    const tree = await mount();
    expect(textOf(tree.root)).toContain('WhatsApp is not connected yet');
    expect(tree.root.findByType(Switch).props.disabled).toBe(true);
  });

  it('says when WhatsApp itself is logged out, and that messages wait', async () => {
    mockStatus = { ...mockStatus, session: 'qr_ready' };
    const tree = await mount();
    expect(textOf(tree.root)).toContain('not ready (qr_ready)');
  });

  it('saves the switch and the reminder days exactly as chosen', async () => {
    const tree = await mount();
    expect(input(tree, 'Reminder days').props.value).toBe('5, 10');
    await act(async () => { tree.root.findByType(Switch).props.onValueChange(true); });
    await act(async () => { input(tree, 'Reminder days').props.onChangeText('3, 12, 12, 40'); });
    await pressButton(tree, 'Save WhatsApp Settings');
    await until(() => mockSave.mock.calls.length === 1);
    expect(mockSave).toHaveBeenCalledWith({ enabled: true, reminderDays: [3, 12] });
  });

  it('sends a test message to the number typed', async () => {
    const tree = await mount();
    await act(async () => { input(tree, 'Test phone number').props.onChangeText('98765 43210'); });
    await pressButton(tree, 'Send test');
    await until(() => mockTest.mock.calls.length === 1);
    expect(mockTest).toHaveBeenCalledWith('98765 43210');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Test sent'));
  });

  it('shows why a test was not sent', async () => {
    mockTest.mockResolvedValue({ sent: false, error: 'Session not ready' });
    const tree = await mount();
    await act(async () => { input(tree, 'Test phone number').props.onChangeText('98765 43210'); });
    await pressButton(tree, 'Send test');
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Not sent'));
    expect((Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Not sent')[1]).toBe('Session not ready');
  });

  it('is read-only for anyone but the admin', async () => {
    mockIsAdmin = false;
    const tree = await mount();
    expect(tree.root.findByType(Switch).props.disabled).toBe(true);
    expect(input(tree, 'Reminder days').props.editable).toBe(false);
    expect(input(tree, 'Test phone number')).toBeUndefined();
  });
});

describe('a society the platform owner has not allowed', () => {
  it('says so, cannot be switched on, and cannot send a test', async () => {
    mockStatus = { ...mockStatus, allowed: false, sendingFrom: null };
    const tree = await mount();
    const text = textOf(tree.root);
    expect(text).toContain('not switched on for your society');
    expect(text).toContain('platform owner allows them one society at a time');
    expect(tree.root.findByType(Switch).props.disabled).toBe(true);
    await act(async () => { input(tree, 'Test phone number').props.onChangeText('98765 43210'); });
    const send = tree.root.findAll((n: any) => n.props.label === 'Send test' && typeof n.props.onPress === 'function')[0];
    expect(send.props.disabled).toBe(true);
  });

  it('does not show the platform\'s number to it', async () => {
    mockStatus = { ...mockStatus, allowed: false, sendingFrom: null, session: 'ready' };
    const tree = await mount();
    expect(textOf(tree.root)).not.toContain('sending from');
  });
});
