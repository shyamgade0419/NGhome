/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Receipts on the Expenses screen, rendered: the camera on the "Add Expense" form, the receipts on a
 * card, and what happens when the camera is off, a file is wrong, or an upload fails. The camera and
 * the file picker are replaced; what is checked is what the person is shown and what is sent.
 */

import React from 'react';
import { Alert, Linking, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPost = jest.fn();
const mockUpload = jest.fn();
const mockOpen = jest.fn();
const mockRemove = jest.fn();
let mockExpenses: any[] = [];

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { data: mockExpenses, meta: {} } })),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
jest.mock('@/api/endpoints/expenses.api', () => ({
  expensesApi: {
    uploadReceipt: (...a: unknown[]) => mockUpload(...a),
    openReceipt: (...a: unknown[]) => mockOpen(...a),
    removeReceipt: (...a: unknown[]) => mockRemove(...a),
  },
}));
jest.mock('@/api/endpoints/accounts.api', () => ({ accountsApi: { list: jest.fn().mockResolvedValue([]) } }));

const mockCamera = jest.fn();
const mockPermission = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockPermission(),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
}));
const mockDocument = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockDocument(...a) }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/layout/ScreenHeader', () => ({ ScreenHeader: ({ rightAction }: any) => rightAction ?? null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

import ExpensesScreen from '../../app/(app)/admin/expenses/index';

jest.useRealTimers();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Wait until something has actually happened, instead of a fixed short pause that a busy machine overruns. */
const until = async (cond: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const pressables = (tree: any) => tree.root.findAllByType(TouchableOpacity);
const byLabel = (tree: any, label: string) => pressables(tree).filter((n: any) => n.props.accessibilityLabel === label);
const byText = (tree: any, label: string) => pressables(tree).filter((n: any) => textOf(n) === label);
/** The buttons of the alert with this title — found by title, as the form's own delayed "Added" alert from an earlier save can land at any point. */
const alertButtons = (title: string) => {
  const calls = (Alert.alert as jest.Mock).mock.calls.filter((c) => c[0] === title);
  return (calls[calls.length - 1][2] ?? []) as { text: string; onPress?: () => void }[];
};

const expense = (over: Record<string, unknown> = {}) => ({
  id: 'exp-1', categoryName: 'REPAIRS', description: 'Lift repair', amount: '2500', expenseDate: '2026-10-01',
  status: 'PENDING', payeeName: null, notes: null, createdAt: '2026-10-01', documents: [], ...over,
});
const stored = (id: string, fileName: string, mimeType = 'image/jpeg') => ({ id, fileName, mimeType, fileSize: 1000 });
const photo = { canceled: false, assets: [{ uri: 'file:///cache/p.jpg', mimeType: 'image/jpeg', fileSize: 400_000 }] };

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><ExpensesScreen /></QueryClientProvider>);
  });
  // Ready means the list has loaded, not "two pauses have passed" — a slow machine overruns those.
  await until(() => !textOf(tree.root).includes('Loading expenses'));
  return tree;
}

/** Open the Add Expense form and fill the two required fields. */
async function openForm(tree: any) {
  // The "+" in the header is the only pressable before anything else is on screen.
  await until(() => pressables(tree).length > 0);
  await act(async () => { pressables(tree)[0].props.onPress(); });
  const formInputs = () => tree.root.findAll((n: any) => n.props.placeholder === 'e.g. Plumber repair work' || n.props.placeholder === '0.00');
  await until(() => formInputs().length >= 2);
  const inputs = formInputs();
  await act(async () => { inputs.find((n: any) => n.props.placeholder === 'e.g. Plumber repair work').props.onChangeText('Tap washers'); });
  await act(async () => { inputs.find((n: any) => n.props.placeholder === '0.00').props.onChangeText('350'); });
}

beforeEach(() => {
  mockExpenses = [];
  mockPost.mockReset().mockResolvedValue({ data: { data: { id: 'new-exp' } } });
  mockUpload.mockReset().mockResolvedValue(stored('r1', 'x.jpg'));
  mockOpen.mockReset().mockResolvedValue(undefined);
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockCamera.mockReset().mockResolvedValue(photo);
  mockPermission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  mockDocument.mockReset().mockResolvedValue({ canceled: true });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Add Expense — the camera', () => {
  it('photographs the bill, shows it on the form, and sends it once the expense is saved', async () => {
    const tree = await mount();
    await openForm(tree);

    await act(async () => { await byLabel(tree, 'Take a photo of the bill')[0].props.onPress(); });
    await flush();
    expect(mockCamera).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], quality: 0.7 }));
    expect(textOf(tree.root)).toMatch(/expense-receipt-\d{8}-\d{6}\.jpg/);
    expect(mockUpload).not.toHaveBeenCalled(); // nothing is sent until the expense exists

    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });
    await until(() => mockUpload.mock.calls.length === 1);
    expect(mockPost).toHaveBeenCalledWith('/expenses', expect.objectContaining({ description: 'Tap washers', amount: 350 }));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith('new-exp', expect.objectContaining({ uri: 'file:///cache/p.jpg', mimeType: 'image/jpeg' }));
  });

  it('saves an expense with no receipt exactly as before', async () => {
    const tree = await mount();
    await openForm(tree);
    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Added'));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('adds nothing when the camera is closed without a photo', async () => {
    mockCamera.mockResolvedValue({ canceled: true, assets: null });
    const tree = await mount();
    await openForm(tree);
    await act(async () => { await byLabel(tree, 'Take a photo of the bill')[0].props.onPress(); });
    await flush();
    expect(textOf(tree.root)).not.toMatch(/expense-receipt-/);
    // No complaint about the camera or the file. (Not "no alert at all": an earlier test's save raises
    // its own "Added" message a moment after that test has ended.)
    const complaints = (Alert.alert as jest.Mock).mock.calls.filter((c) => ['Camera is off', 'Cannot add this', 'Could not add it'].includes(c[0]));
    expect(complaints).toEqual([]);
  });

  it('says why when the camera is off and cannot be asked again, and offers the phone\'s settings', async () => {
    mockPermission.mockResolvedValue({ granted: false, canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = await mount();
    await openForm(tree);
    await act(async () => { await byLabel(tree, 'Take a photo of the bill')[0].props.onPress(); });
    await flush();
    expect(mockCamera).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Camera is off', expect.stringContaining('settings'), expect.any(Array));
    await act(async () => { alertButtons('Camera is off').find((b) => b.text === 'Open settings')!.onPress!(); });
    expect(openSettings).toHaveBeenCalled();
  });

  it('keeps the expense when a receipt will not upload, and says which part failed', async () => {
    mockUpload.mockRejectedValue(new Error('network'));
    const tree = await mount();
    await openForm(tree);
    await act(async () => { await byLabel(tree, 'Take a photo of the bill')[0].props.onPress(); });
    await flush();
    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });
    // the confirmation waits for the sheet to close
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Expense saved'));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Expense saved', expect.stringContaining('Add receipt'));
  });

  it('lets a chosen receipt be taken off before saving', async () => {
    const tree = await mount();
    await openForm(tree);
    await act(async () => { await byLabel(tree, 'Take a photo of the bill')[0].props.onPress(); });
    await flush();
    const remove = pressables(tree).find((n: any) => /^Remove expense-receipt-/.test(n.props.accessibilityLabel ?? ''))!;
    await act(async () => { remove.props.onPress(); });
    expect(textOf(tree.root)).not.toMatch(/expense-receipt-\d/);
    await act(async () => { byText(tree, 'Save Expense')[0].props.onPress(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Added'));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a photo or PDF, and says so', async () => {
    mockDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x.csv', name: 'x.csv', mimeType: 'text/csv', size: 10 }] });
    const tree = await mount();
    await openForm(tree);
    await act(async () => { await byLabel(tree, 'Attach a photo or PDF from the phone')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Cannot add this', expect.stringMatching(/photo or a PDF/));
    expect(textOf(tree.root)).not.toContain('x.csv');
  });
});

describe('Expense card — receipts', () => {
  it('lists the receipts and the count', async () => {
    mockExpenses = [expense({ documents: [stored('a', 'bill-1.jpg'), stored('b', 'invoice.pdf', 'application/pdf')] })];
    const text = textOf((await mount()).root);
    expect(text).toContain('2 receipts');
    expect(text).toContain('bill-1.jpg');
    expect(text).toContain('invoice.pdf');
  });

  it('offers "Add receipt" on an expense with none, so the camera is one tap from the list', async () => {
    mockExpenses = [expense()];
    const text = textOf((await mount()).root);
    expect(text).toContain('No receipts');
    expect(text).toContain('Add receipt');
  });

  it('adds a receipt to a saved expense from the camera', async () => {
    mockExpenses = [expense()];
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Add a receipt')[0].props.onPress(); });
    expect(Alert.alert).toHaveBeenCalledWith('Add a receipt', undefined, expect.any(Array));
    await act(async () => { await alertButtons('Add a receipt').find((b) => b.text === 'Take photo')!.onPress!(); });
    await until(() => mockUpload.mock.calls.length === 1);
    expect(mockUpload).toHaveBeenCalledWith('exp-1', expect.objectContaining({ mimeType: 'image/jpeg' }));
  });

  it('shows the server\'s reason when the upload is refused', async () => {
    mockExpenses = [expense()];
    mockUpload.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'An expense can have at most 6 receipts.' } } }));
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Add a receipt')[0].props.onPress(); });
    await act(async () => { await alertButtons('Add a receipt').find((b) => b.text === 'Take photo')!.onPress!(); });
    await until(() => (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Receipt not added'));
    expect(Alert.alert).toHaveBeenCalledWith('Receipt not added', 'An expense can have at most 6 receipts.');
  });

  it('opens a receipt when tapped', async () => {
    const r = stored('a', 'bill-1.jpg');
    mockExpenses = [expense({ documents: [r] })];
    const tree = await mount();
    await act(async () => { await byLabel(tree, 'Open bill-1.jpg')[0].props.onPress(); });
    expect(mockOpen).toHaveBeenCalledWith('exp-1', r);
  });

  it('asks before removing, then removes', async () => {
    mockExpenses = [expense({ documents: [stored('a', 'bill-1.jpg')] })];
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Remove bill-1.jpg')[0].props.onPress(); });
    expect(mockRemove).not.toHaveBeenCalled();
    await act(async () => { alertButtons('Remove this receipt?').find((b) => b.text === 'Remove')!.onPress!(); });
    await until(() => mockRemove.mock.calls.length === 1);
    expect(mockRemove).toHaveBeenCalledWith('exp-1', 'a');
  });

  it('stops offering removal once the expense is paid, but still takes a late receipt', async () => {
    mockExpenses = [expense({ status: 'PAID', documents: [stored('a', 'bill-1.jpg')] })];
    const tree = await mount();
    expect(byLabel(tree, 'Remove bill-1.jpg')).toHaveLength(0);
    expect(byLabel(tree, 'Add a receipt')).toHaveLength(1);
  });

  it('shows nothing about receipts on a rejected expense that has none', async () => {
    mockExpenses = [expense({ status: 'REJECTED' })];
    const text = textOf((await mount()).root);
    expect(text).not.toContain('No receipts');
    expect(text).not.toContain('Add receipt');
  });

  it('stops offering "Add receipt" at the limit', async () => {
    mockExpenses = [expense({ documents: Array.from({ length: 6 }, (_, i) => stored(`r${i}`, `b${i}.jpg`)) })];
    const tree = await mount();
    expect(textOf(tree.root)).toContain('6 receipts');
    expect(byLabel(tree, 'Add a receipt')).toHaveLength(0);
  });
});
