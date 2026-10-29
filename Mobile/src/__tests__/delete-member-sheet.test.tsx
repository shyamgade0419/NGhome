/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Permanent member delete, from the admin's phone. The sheet must say what a
 * delete would take and what stops it, keep the Delete button off until the
 * account's own email is typed, and POST (not DELETE) with that email.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { DeleteMemberSheet, confirmationMatches } from '@/components/members/DeleteMemberSheet';

type Tree = ReturnType<typeof TestRenderer.create>;

jest.useRealTimers();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const MEMBER = { userId: 'u-1', name: 'Anil Kumar', email: 'anil@example.com' };

function preview(over: Record<string, unknown> = {}) {
  return {
    data: {
      data: {
        user: { id: 'u-1', name: 'Anil Kumar', email: 'anil@example.com', phone: null },
        willRemove: [{ label: 'Notifications', count: 3 }],
        blockedBy: [],
        reasons: [],
        canDelete: true,
        ...over,
      },
    },
  };
}

async function open(onClose = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: Tree;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={qc}>
        <DeleteMemberSheet member={MEMBER} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return { tree, onClose };
}

const texts = (tree: Tree) =>
  tree.root
    .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
    .map((n: any) => n.children.join(''))
    .join(' | ');

const deleteBtn = (tree: Tree) => tree.root.findByProps({ label: 'Delete permanently' });

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset().mockResolvedValue({ data: { data: { id: 'u-1', name: 'Anil Kumar', email: 'anil@example.com' } } });
});

describe('confirmationMatches', () => {
  it.each([
    ['anil@example.com', 'anil@example.com', true],
    ['  ANIL@Example.com ', 'anil@example.com', true],
    ['anil@example.co', 'anil@example.com', false],
    ['', 'anil@example.com', false],
    ['anything', '', false],
  ])('%j vs %j -> %s', (typed, email, expected) => expect(confirmationMatches(typed, email)).toBe(expected));
});

describe('DeleteMemberSheet', () => {
  it('asks the server what would happen before offering anything', async () => {
    mockGet.mockResolvedValue(preview());
    const { tree } = await open();
    expect(mockGet).toHaveBeenCalledWith('/users/society/u-1/deletion-preview');
    expect(texts(tree)).toContain('Delete account permanently');
    expect(texts(tree)).toContain('Notifications: 3');
    expect(texts(tree)).toContain('anil@example.com');
  });

  it('shows what stops it and offers no delete button when records are kept', async () => {
    mockGet.mockResolvedValue(preview({ canDelete: false, blockedBy: [{ label: 'Payments they submitted', count: 4 }] }));
    const { tree } = await open();
    expect(texts(tree)).toContain('Payments they submitted: 4');
    expect(texts(tree)).toContain('Use Remove instead');
    expect(texts(tree)).not.toContain('Delete permanently');
    expect(texts(tree)).toContain('Close');
  });

  it('shows the reason when the account cannot be deleted (e.g. the only admin)', async () => {
    mockGet.mockResolvedValue(preview({ canDelete: false, reasons: ['They are the only admin of this society.'] }));
    const { tree } = await open();
    expect(texts(tree)).toContain('only admin');
    expect(texts(tree)).not.toContain('Delete permanently');
  });

  it('keeps Delete off until the email is typed, then POSTs it', async () => {
    mockGet.mockResolvedValue(preview());
    const { tree, onClose } = await open();
    const input = tree.root.findByProps({ accessibilityLabel: 'Type the email to confirm' });

    const isDisabled = () => !!deleteBtn(tree).props.disabled;

    expect(isDisabled()).toBe(true);
    await act(async () => input.props.onChangeText('wrong@example.com'));
    expect(isDisabled()).toBe(true);
    await act(async () => input.props.onChangeText('  ANIL@example.com '));
    expect(isDisabled()).toBe(false);

    await act(async () => deleteBtn(tree).props.onPress());
    await flush();

    expect(mockPost).toHaveBeenCalledWith('/users/society/u-1/delete', { confirmEmail: 'ANIL@example.com' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server message and stays open when the delete is refused', async () => {
    mockGet.mockResolvedValue(preview());
    mockPost.mockRejectedValue({ response: { data: { message: 'They belong to another society too.' } } });
    const { tree, onClose } = await open();
    await act(async () => tree.root.findByProps({ accessibilityLabel: 'Type the email to confirm' }).props.onChangeText('anil@example.com'));
    await act(async () => deleteBtn(tree).props.onPress());
    await flush();
    expect(texts(tree)).toContain('They belong to another society too.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
