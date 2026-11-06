/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The welcome slides on a new phone: three slides, Next and Skip, remembering that they were shown, and where a signed-out
 * person is sent when the app opens.
 */

import React from 'react';
import { Dimensions, FlatList, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockReplace = jest.fn();
const store: Record<string, string> = {};
let mockStorageBroken = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => { if (mockStorageBroken) throw new Error('no storage'); return store[k] ?? null; },
    setItem: async (k: string, v: string) => { if (mockStorageBroken) throw new Error('no storage'); store[k] = v; },
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a) }),
  Redirect: ({ href }: { href: string }) => { const { Text } = jest.requireActual('react-native'); return <Text>{`redirect:${href}`}</Text>; },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});
let mockAuth: any = { isAuthenticated: false, isLoading: false, needsSocietySelection: false };
jest.mock('@/auth/AuthContext', () => ({ useAuthContext: () => mockAuth }));

import WelcomeScreen, { WELCOME_SLIDES } from '../../app/welcome';
import Index from '../../app/index';
import { hasSeenWelcome, markWelcomeSeen } from '@/onboarding/welcome';

jest.useRealTimers();
jest.setTimeout(30_000);
const until = async (cond: () => boolean, ms = 8000) => {
  const start = Date.now();
  while (!cond() && Date.now() - start < ms) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(cond()).toBe(true);
};
const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const trees: any[] = [];
async function render(el: React.ReactElement) {
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(el); });
  trees.push(tree);
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });
beforeEach(() => {
  mockReplace.mockReset();
  for (const k of Object.keys(store)) delete store[k];
  mockStorageBroken = false;
  mockAuth = { isAuthenticated: false, isLoading: false, needsSocietySelection: false };
});
// The list pages by the screen's width, whatever the test renderer's screen is.
const W = Dimensions.get('window').width;
const pressButton = async (tree: any, label: string) => {
  const b = tree.root.findAll((n: any) => n.props.label === label && typeof n.props.onPress === 'function')[0];
  await act(async () => { b.props.onPress(); });
};

describe('remembering the welcome slides', () => {
  it('has not shown them on a new phone, and has once they are marked', async () => {
    expect(await hasSeenWelcome()).toBe(false);
    await markWelcomeSeen();
    expect(await hasSeenWelcome()).toBe(true);
  });

  it('never sends a phone that cannot remember through the slides on every launch', async () => {
    mockStorageBroken = true;
    expect(await hasSeenWelcome()).toBe(true);
    await expect(markWelcomeSeen()).resolves.toBeUndefined();
  });
});

describe('the welcome screen', () => {
  it('has three slides, each with a picture, a title and a few words', () => {
    expect(WELCOME_SLIDES).toHaveLength(3);
    for (const s of WELCOME_SLIDES) {
      expect(s.title.length).toBeGreaterThan(5);
      expect(s.body.length).toBeGreaterThan(30);
      expect(s.Scene).toBeDefined();
    }
  });

  it('opens on the first slide with Next and Skip', async () => {
    const tree = await render(<WelcomeScreen />);
    const text = textOf(tree.root);
    expect(text).toContain('Pay maintenance in a tap');
    expect(text).toContain('Skip');
    expect(tree.root.findAll((n: any) => n.props.label === 'Next').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n: any) => n.props.label === 'Get started')).toHaveLength(0);
  });

  it('moves to the next slide on Next, and offers Get started on the last', async () => {
    const tree = await render(<WelcomeScreen />);
    const flat = tree.root.findByType(FlatList);
    const scrolled = jest.fn();
    (flat.instance as any).scrollToIndex = scrolled;
    await pressButton(tree, 'Next');
    expect(scrolled).toHaveBeenCalledWith({ index: 1, animated: true });
    // The list reports where it has got to: the last slide.
    await act(async () => { flat.props.onScroll({ nativeEvent: { contentOffset: { x: 2 * W } } }); });
    await until(() => tree.root.findAll((n: any) => n.props.label === 'Get started').length > 0);
  });

  it('remembers that it was shown and goes to sign-in on Get started, and on Skip', async () => {
    const a = await render(<WelcomeScreen />);
    await act(async () => { a.root.findByType(FlatList).props.onScroll({ nativeEvent: { contentOffset: { x: 2 * W } } }); });
    await pressButton(a, 'Get started');
    await until(() => mockReplace.mock.calls.length === 1);
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    expect(await hasSeenWelcome()).toBe(true);

    for (const k of Object.keys(store)) delete store[k];
    mockReplace.mockReset();
    const b = await render(<WelcomeScreen />);
    await act(async () => { b.root.findAllByType(TouchableOpacity).find((n: any) => n.props.accessibilityLabel === 'Skip the introduction').props.onPress(); });
    await until(() => mockReplace.mock.calls.length === 1);
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    expect(await hasSeenWelcome()).toBe(true);
  });
});

describe('where the app opens', () => {
  it('shows the welcome slides to a signed-out person on a new phone', async () => {
    const tree = await render(<Index />);
    await until(() => textOf(tree.root).includes('redirect:'));
    expect(textOf(tree.root)).toContain('redirect:/welcome');
  });

  it('goes straight to sign-in once the slides have been seen', async () => {
    await markWelcomeSeen();
    const tree = await render(<Index />);
    await until(() => textOf(tree.root).includes('redirect:'));
    expect(textOf(tree.root)).toContain('redirect:/(auth)/login');
  });

  it('never shows the slides to someone who is signed in, or choosing a society', async () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsSocietySelection: false };
    const signedIn = await render(<Index />);
    await until(() => textOf(signedIn.root).includes('redirect:'));
    expect(textOf(signedIn.root)).toContain('redirect:/(app)');

    mockAuth = { isAuthenticated: false, isLoading: false, needsSocietySelection: true };
    const choosing = await render(<Index />);
    await until(() => textOf(choosing.root).includes('redirect:'));
    expect(textOf(choosing.root)).toContain('redirect:/(society-select)');
  });

  it('waits while the session is still being restored', async () => {
    mockAuth = { isAuthenticated: false, isLoading: true, needsSocietySelection: false };
    const tree = await render(<Index />);
    expect(textOf(tree.root)).toContain('Starting NG Home');
    expect(textOf(tree.root)).not.toContain('redirect:');
  });
});
