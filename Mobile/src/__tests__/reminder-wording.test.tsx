/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The reminder wording editor: the first reminder and the second one, each written on its own, saved only when changed, and
 * saved as "unset" when it matches the standard. An older server that has no second reminder shows only the first.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPatch = jest.fn();
let mockTemplate: any;

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => mockPatch(...a), get: jest.fn() },
}));
jest.mock('@/api/endpoints/billing.api', () => ({
  billingApi: { getReminderTemplate: async () => mockTemplate },
}));

import { ReminderTemplateEditor } from '@/components/billing/ReminderTemplateEditor';
import { Button } from '@/components/ui/Button';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const input = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === TextInput && n.props.accessibilityLabel === label)[0];
const byLabel = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === label)[0];
const saveButton = (tree: any) => tree.root.findAll((n: any) => n.type === Button)[0];
const trees: any[] = [];
async function mount(waitFor = 'Reminder message') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<QueryClientProvider client={qc}><ReminderTemplateEditor /></QueryClientProvider>); });
  trees.push(tree);
  await until(() => !!input(tree, waitFor));
  return tree;
}

const FIRST_DEFAULT = 'Dear {name}, a gentle reminder for {flat}.';
const SECOND_DEFAULT = 'Dear {name}, this is a second reminder for {flat}.';

beforeEach(() => {
  mockPatch.mockReset().mockResolvedValue({ data: {} });
  mockTemplate = {
    template: FIRST_DEFAULT, isDefault: true, defaultTemplate: FIRST_DEFAULT,
    finalTemplate: SECOND_DEFAULT, isFinalDefault: true, defaultFinalTemplate: SECOND_DEFAULT,
    placeholders: [{ token: '{name}', meaning: "the resident's name" }, { token: '{flat}', meaning: 'the flat number' }],
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('Reminder wording editor', () => {
  it('shows the first and the second reminder, each with its own wording and its own preview', async () => {
    const tree = await mount('Second reminder message');
    expect(input(tree, 'Reminder message').props.value).toBe(FIRST_DEFAULT);
    expect(input(tree, 'Second reminder message').props.value).toBe(SECOND_DEFAULT);
    const text = textOf(tree.root);
    expect(text).toContain('First reminder');
    expect(text).toContain('Second reminder');
    expect(text).toContain('a gentle reminder for A-101'); // the preview fills in a sample flat
    expect(text).toContain('this is a second reminder for A-101');
  });

  it('keeps the save button off until something is changed', async () => {
    const tree = await mount('Second reminder message');
    expect(saveButton(tree).props.disabled).toBe(true);
    await act(async () => { input(tree, 'Second reminder message').props.onChangeText('Pay {name} now'); });
    expect(saveButton(tree).props.disabled).toBe(false);
  });

  it('saves only the second wording when only that was changed, and the first only when only that was', async () => {
    let tree = await mount('Second reminder message');
    await act(async () => { input(tree, 'Second reminder message').props.onChangeText('  Pay {name} now  '); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/societies/my/config', { finalReminderTemplate: 'Pay {name} now' });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Saved');

    await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
    mockPatch.mockClear();
    tree = await mount('Second reminder message');
    await act(async () => { input(tree, 'Reminder message').props.onChangeText('Hello {name}'); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/societies/my/config', { reminderTemplate: 'Hello {name}' });
  });

  it('saves both when both were changed', async () => {
    const tree = await mount('Second reminder message');
    await act(async () => { input(tree, 'Reminder message').props.onChangeText('One {name}'); });
    await act(async () => { input(tree, 'Second reminder message').props.onChangeText('Two {name}'); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/societies/my/config', { reminderTemplate: 'One {name}', finalReminderTemplate: 'Two {name}' });
  });

  it('saves a wording that matches the standard as "unset", so the society follows the standard', async () => {
    mockTemplate = { ...mockTemplate, template: 'Custom first {name}', isDefault: false, finalTemplate: 'Custom second {name}', isFinalDefault: false };
    const tree = await mount('Second reminder message');
    await act(async () => { input(tree, 'Reminder message').props.onChangeText(FIRST_DEFAULT); });
    await act(async () => { input(tree, 'Second reminder message').props.onChangeText(SECOND_DEFAULT); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/societies/my/config', { reminderTemplate: '', finalReminderTemplate: '' });
  });

  it('goes back to the standard second reminder without touching the first', async () => {
    mockTemplate = { ...mockTemplate, finalTemplate: 'Custom second {name}', isFinalDefault: false };
    const tree = await mount('Second reminder message');
    expect(byLabel(tree, 'Go back to the standard second reminder')).toBeDefined();
    expect(byLabel(tree, 'Go back to the standard wording')).toBeUndefined(); // the first is already the standard
    await act(async () => { byLabel(tree, 'Go back to the standard second reminder').props.onPress(); });
    expect(input(tree, 'Second reminder message').props.value).toBe(SECOND_DEFAULT);
    expect(input(tree, 'Reminder message').props.value).toBe(FIRST_DEFAULT);
  });

  it('adds a detail to the box it was tapped under, not the other one', async () => {
    const tree = await mount('Second reminder message');
    const chips = tree.root.findAll((n: any) => n.type === TouchableOpacity && String(n.props.accessibilityLabel ?? '').startsWith('Add {flat}'));
    expect(chips).toHaveLength(2); // one set under each box
    await act(async () => { chips[1].props.onPress(); });
    expect(input(tree, 'Second reminder message').props.value).toBe(`${SECOND_DEFAULT} {flat}`);
    expect(input(tree, 'Reminder message').props.value).toBe(FIRST_DEFAULT);
  });

  it('shows only the first reminder when the server does not know a second one, and never sends one', async () => {
    mockTemplate = { template: FIRST_DEFAULT, isDefault: true, defaultTemplate: FIRST_DEFAULT, placeholders: [] };
    const tree = await mount();
    expect(input(tree, 'Second reminder message')).toBeUndefined();
    expect(textOf(tree.root)).not.toContain('Second reminder');
    await act(async () => { input(tree, 'Reminder message').props.onChangeText('Only {name}'); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => mockPatch.mock.calls.length === 1);
    expect(mockPatch).toHaveBeenCalledWith('/societies/my/config', { reminderTemplate: 'Only {name}' });
  });

  it('says why when saving fails, and keeps what was typed', async () => {
    mockPatch.mockRejectedValue({ response: { data: { message: 'finalReminderTemplate must be shorter than or equal to 1500 characters' } } });
    const tree = await mount('Second reminder message');
    await act(async () => { input(tree, 'Second reminder message').props.onChangeText('Keep me {name}'); });
    await act(async () => { saveButton(tree).props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.length === 1);
    expect((Alert.alert as jest.Mock).mock.calls[0]).toEqual(['Error', 'finalReminderTemplate must be shorter than or equal to 1500 characters']);
    expect(input(tree, 'Second reminder message').props.value).toBe('Keep me {name}');
  });
});
