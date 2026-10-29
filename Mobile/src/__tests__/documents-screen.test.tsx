/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Documents screen for an admin, rendered. What matters: an admin can upload a real file and
 * choose who sees it (not only paste a link); the choice reaches the server; a file over the
 * limit is refused before it uploads; and a resident is not offered the official upload.
 */

import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockRole = 'SOCIETY_ADMIN';
let mockFlatId: string | undefined;
const mockPost = jest.fn();
const mockPick = jest.fn();

jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: [] })),
    post: (...args: unknown[]) => mockPost(...args),
  },
  API_BASE_URL: 'http://x',
}));
jest.mock('@/auth/token.service', () => ({ tokenService: { getAccessToken: async () => null } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { currentRole: mockRole, flatId: mockFlatId } }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: '/tmp/', downloadAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

import DocumentsScreen from '../../app/(app)/documents';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);
const byLabel = (tree: any, label: string) => tree.root.findAllByProps({ accessibilityLabel: label }).filter((n: any) => typeof n.type !== 'string');

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}><DocumentsScreen /></QueryClientProvider>);
  });
  await flush();
  return tree;
}

/** Records what is appended, since Node's FormData cannot be inspected and stringifies the file object. */
class RecordingFormData {
  fields: Record<string, unknown> = {};
  append(key: string, value: unknown) {
    this.fields[key] = value;
  }
}

/** The fields of the first upload request. */
const sentFields = () => (mockPost.mock.calls[0][1] as RecordingFormData).fields;

beforeEach(() => {
  (global as any).FormData = RecordingFormData;
  mockRole = 'SOCIETY_ADMIN';
  mockFlatId = undefined;
  mockPost.mockReset().mockResolvedValue({ data: { data: { id: 'd1' } } });
  mockPick.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/bye-laws-2026.pdf', name: 'bye-laws-2026.pdf', mimeType: 'application/pdf', size: 2048 }] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Documents — what each role is offered', () => {
  it('an admin gets both a file upload and the link option', async () => {
    const tree = await mount();
    expect(byLabel(tree, 'Upload a document').length).toBeGreaterThan(0);
    expect(byLabel(tree, 'Add a link to a document').length).toBeGreaterThan(0);
  });

  it('the committee can upload but not paste a link', async () => {
    mockRole = 'COMMITTEE_MEMBER';
    const tree = await mount();
    expect(byLabel(tree, 'Upload a document').length).toBeGreaterThan(0);
    expect(byLabel(tree, 'Add a link to a document')).toHaveLength(0);
  });

  it('a resident is offered neither on the Society tab', async () => {
    mockRole = 'RESIDENT';
    mockFlatId = 'f1';
    const tree = await mount();
    expect(byLabel(tree, 'Upload a document')).toHaveLength(0);
    expect(byLabel(tree, 'Add a link to a document')).toHaveLength(0);
  });
});

describe('Documents — an admin uploads a file', () => {
  async function openUpload(tree: any) {
    await act(async () => { byLabel(tree, 'Upload a document')[0].props.onPress(); });
  }
  const pick = async (tree: any) => { await act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => textOf(n).startsWith('Choose a file'))!.props.onPress(); }); await flush(); };

  it('asks who can see it, with residents as the starting point', async () => {
    const tree = await mount();
    await openUpload(tree);
    const text = textOf(tree.root);
    expect(text).toContain('Upload Document');
    expect(text).toContain('Visible To');
    for (const l of ['Everyone', 'Residents', 'Committee', 'Admins only']) expect(text).toContain(l);
    expect(text).toContain('Residents of the society.');
    expect(text).not.toContain('Private to your flat');
  });

  it('will not upload until a file and a title exist; the title is taken from the file name', async () => {
    const tree = await mount();
    await openUpload(tree);
    expect(buttons(tree, 'Upload')[0].props.disabled).toBeTruthy();
    await pick(tree);
    expect(buttons(tree, 'Upload')[0].props.disabled).toBeFalsy();
  });

  it('sends the file with the chosen visibility to the upload endpoint', async () => {
    const tree = await mount();
    await openUpload(tree);
    await pick(tree);
    await act(async () => { buttons(tree, 'Committee')[0].props.onPress(); });
    expect(textOf(tree.root)).toContain('The committee and admins only.');
    await act(async () => { buttons(tree, 'Upload')[0].props.onPress(); });
    await flush();

    expect(mockPost.mock.calls[0][0]).toBe('/documents/upload');
    const fields = sentFields();
    expect(fields.title).toBe('bye-laws-2026');
    expect(fields.accessLevel).toBe('COMMITTEE_ONLY');
    expect(fields.flatId).toBeUndefined();
    expect(fields.file).toMatchObject({ uri: 'file:///tmp/bye-laws-2026.pdf', name: 'bye-laws-2026.pdf', type: 'application/pdf' });
    expect(Alert.alert).toHaveBeenCalledWith('Uploaded', 'Visible to: committee.');
  });

  it('defaults to residents when nothing is chosen', async () => {
    const tree = await mount();
    await openUpload(tree);
    await pick(tree);
    await act(async () => { buttons(tree, 'Upload')[0].props.onPress(); });
    await flush();
    expect(sentFields().accessLevel).toBe('RESIDENTS_ONLY');
  });

  it('refuses a file over 10 MB before uploading it', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }] });
    const tree = await mount();
    await openUpload(tree);
    await pick(tree);
    expect(Alert.alert).toHaveBeenCalledWith('File too large', expect.stringContaining('10 MB'));
    expect(buttons(tree, 'Upload')[0].props.disabled).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when the upload fails', async () => {
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'File storage is not set up for this society.' } } });
    const tree = await mount();
    await openUpload(tree);
    await pick(tree);
    await act(async () => { buttons(tree, 'Upload')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'File storage is not set up for this society.');
  });

  it('the link form is still there, and clearly a link', async () => {
    const tree = await mount();
    await act(async () => { byLabel(tree, 'Add a link to a document')[0].props.onPress(); });
    const text = textOf(tree.root);
    expect(text).toContain('Add a Link');
    expect(text).toContain('File Link / Key');
  });
});
