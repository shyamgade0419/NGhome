/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Look picker on the profile screens: two choices, the current one marked, a new choice kept and said to apply next time the app
 * opens, and (on Android) a button to close the app so that happens straight away.
 */

import React from 'react';
import { BackHandler, Platform, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockSave = jest.fn();
let mockChosen = 'glass';
jest.mock('@/theme/look', () => ({
  __esModule: true,
  isGlass: false, // keep the plain button and card in this test
  appliedLook: 'glass',
  chosenLook: () => mockChosen,
  saveLook: (...a: unknown[]) => mockSave(...a),
}));

import { LookPicker } from '@/components/settings/LookPicker';

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const option = (tree: any, label: string) => tree.root.findAll((n: any) => n.type === TouchableOpacity && n.props.accessibilityLabel === label)[0];
const trees: any[] = [];
async function mount() {
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(<LookPicker />); });
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  mockChosen = 'glass';
  mockSave.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await act(async () => { trees.splice(0).forEach((t) => t.unmount()); });
});

describe('Look picker', () => {
  it('offers Glass and Classic, with the one in use marked', async () => {
    const tree = await mount();
    expect(textOf(tree.root)).toContain('Glass');
    expect(textOf(tree.root)).toContain('Classic');
    expect(option(tree, 'Glass look').props.accessibilityState).toEqual({ selected: true });
    expect(option(tree, 'Classic look').props.accessibilityState).toEqual({ selected: false });
    expect(textOf(tree.root)).not.toContain('next time you open the app'); // nothing is waiting
  });

  it('keeps a new choice, marks it, and says it shows the next time the app opens', async () => {
    const tree = await mount();
    await act(async () => { option(tree, 'Classic look').props.onPress(); });
    expect(mockSave).toHaveBeenCalledWith('classic');
    expect(option(tree, 'Classic look').props.accessibilityState).toEqual({ selected: true });
    expect(option(tree, 'Glass look').props.accessibilityState).toEqual({ selected: false });
    expect(textOf(tree.root)).toContain('next time you open the app');
  });

  it('stops saying a change is waiting once the choice is back to the look in use', async () => {
    const tree = await mount();
    await act(async () => { option(tree, 'Classic look').props.onPress(); });
    await act(async () => { option(tree, 'Glass look').props.onPress(); });
    expect(mockSave).toHaveBeenLastCalledWith('glass');
    expect(textOf(tree.root)).not.toContain('next time you open the app');
  });

  it('starts from what was last chosen, so a waiting change is still shown after leaving and coming back', async () => {
    mockChosen = 'classic';
    const tree = await mount();
    expect(option(tree, 'Classic look').props.accessibilityState).toEqual({ selected: true });
    expect(textOf(tree.root)).toContain('next time you open the app');
  });

  it('offers to close the app on Android, and only then', async () => {
    const exit = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
    const realOS = Platform.OS;
    try {
      (Platform as any).OS = 'android';
      const tree = await mount();
      await act(async () => { option(tree, 'Classic look').props.onPress(); });
      const close = tree.root.findAll((n: any) => n.props.label === 'Close the app now' && typeof n.props.onPress === 'function')[0];
      expect(close).toBeDefined();
      await act(async () => { close.props.onPress(); });
      expect(exit).toHaveBeenCalledTimes(1);

      (Platform as any).OS = 'ios';
      const ios = await mount();
      await act(async () => { option(ios, 'Classic look').props.onPress(); });
      expect(ios.root.findAll((n: any) => n.props.label === 'Close the app now')).toHaveLength(0);
    } finally {
      (Platform as any).OS = realOS;
    }
  });
});
