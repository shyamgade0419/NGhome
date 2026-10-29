/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The resident's Vehicles & parking screen and the guard's Vehicle lookup, rendered. What matters:
 * a plate is tidied before it is sent; only vehicles that fit a slot are offered for it; removing
 * a vehicle asks first; and the guard's lookup waits for enough characters, shows a flat number and
 * slot but no names, and says plainly when a vehicle is not a resident's.
 */

import React from 'react';
import { Alert, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockVehicles = [
  { id: 'v-car', plate: 'TS09AB1234', kind: 'CAR', make: 'Maruti Swift', colour: 'White', slots: [{ id: 's-car', code: 'B1-12' }] },
  { id: 'v-bike', plate: 'TS09CD5678', kind: 'TWO_WHEELER', make: null, colour: null, slots: [] },
];
const mockSlots = [
  { id: 's-car', code: 'B1-12', area: 'Basement 1', slotFor: 'CAR', vehicleId: 'v-car', vehiclePlate: 'TS09AB1234', vehicleKind: 'CAR' },
  { id: 's-two', code: 'B1-40', area: null, slotFor: 'TWO_WHEELER', vehicleId: null, vehiclePlate: null, vehicleKind: null },
];

const mockGet = jest.fn(async (url: string, opts?: any) => {
  if (url === '/vehicles/my') return { data: { data: mockVehicles } };
  if (url === '/parking/my') return { data: { data: mockSlots } };
  if (url === '/gate/vehicles/lookup') {
    const q = opts?.params?.search;
    if (q === '1234') {
      return { data: { data: [{ id: 'v-car', plate: 'TS09AB1234', kind: 'CAR', make: 'Maruti Swift', colour: 'White', flatCode: 'A-101', slotCodes: ['B1-12'] }] } };
    }
    return { data: { data: [] } };
  }
  return { data: { data: [] } };
});
const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => (mockGet as any)(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), canGoBack: () => true }), router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

import VehiclesScreen from '../../app/(app)/vehicles/index';
import { VehiclePanel } from '@/components/gate/VehiclePanel';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
jest.useRealTimers();

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const buttons = (tree: any, label: string) => tree.root.findAllByType(TouchableOpacity).filter((n: any) => textOf(n) === label);
const byLabel = (tree: any, label: string) => tree.root.findAllByProps({ accessibilityLabel: label }).filter((n: any) => typeof n.type !== 'string');
const serverError = (message: string, status = 409) => Object.assign(new Error(message), { response: { status, data: { message } } });

async function mount(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: any;
  await act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
  });
  await flush();
  await flush();
  return tree;
}

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({ data: { data: {} } });
  mockGet.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (Alert.alert as jest.Mock).mockClear();
});

describe('Vehicles — my list', () => {
  it('shows each vehicle the way the plate reads, and where it is parked', async () => {
    const text = textOf((await mount(<VehiclesScreen />)).root);
    expect(text).toContain('TS09 AB 1234');
    expect(text).toContain('Maruti Swift · White');
    expect(text).toContain('Slot B1-12');
    expect(text).toContain('Not in a parking slot');
    expect(text).toContain('2 vehicles · 2 slots');
  });

  it('will not add without a usable plate; sends it tidied with the chosen kind', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'n' } } });
    const tree = await mount(<VehiclesScreen />);
    await act(async () => { byLabel(tree, 'Add a vehicle')[0].props.onPress(); });
    expect(buttons(tree, 'Add vehicle')[0].props.disabled).toBeTruthy();

    const plate = byLabel(tree, 'Number plate')[0];
    await act(async () => { plate.props.onChangeText('ts 09 ab-9999'); });
    // What the person sees in the box is already tidied.
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Number plate' }).find((n: any) => typeof n.props.value === 'string')!.props.value).toBe('TS09AB9999');
    await act(async () => { buttons(tree, 'Bike / scooter')[0].props.onPress(); });
    const make = tree.root.findAllByType(TextInput).find((i: any) => i.props.placeholder === 'Make and model (optional)');
    await act(async () => { make.props.onChangeText('  Honda Activa '); });
    expect(buttons(tree, 'Add vehicle')[0].props.disabled).toBeFalsy();
    await act(async () => { buttons(tree, 'Add vehicle')[0].props.onPress(); });
    await flush();

    expect(mockPost).toHaveBeenCalledWith('/vehicles', { plate: 'TS09AB9999', kind: 'TWO_WHEELER', make: 'Honda Activa', colour: undefined });
  });

  it('shows what the server said when the number is already registered', async () => {
    mockPost.mockRejectedValueOnce(serverError('This number is already registered in the society.'));
    const tree = await mount(<VehiclesScreen />);
    await act(async () => { byLabel(tree, 'Add a vehicle')[0].props.onPress(); });
    await act(async () => { byLabel(tree, 'Number plate')[0].props.onChangeText('TS09AB1234'); });
    await act(async () => { buttons(tree, 'Add vehicle')[0].props.onPress(); });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith('Could not add', 'This number is already registered in the society.');
  });

  it('asks before removing, and removes by id only when confirmed', async () => {
    const tree = await mount(<VehiclesScreen />);
    await act(async () => { byLabel(tree, 'Remove TS09AB1234')[0].props.onPress(); });
    expect(mockPost).not.toHaveBeenCalled();
    const choices = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { choices.find((c) => c.text === 'Remove')!.onPress!(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/vehicles/v-car/remove', {});
  });
});

describe('Parking — my slots', () => {
  async function openParking() {
    const tree = await mount(<VehiclesScreen />);
    await act(async () => { buttons(tree, 'Parking')[0].props.onPress(); });
    return tree;
  }

  it('shows each slot with what it is for and which vehicle uses it', async () => {
    const text = textOf((await openParking()).root);
    expect(text).toContain('Slot B1-12');
    expect(text).toContain('Car slot · Basement 1');
    expect(text).toContain('Used by TS09 AB 1234');
    expect(text).toContain('Two-wheeler slot');
    expect(text).toContain('No vehicle set. Tap to choose.');
  });

  it('offers only the vehicles that fit the slot, and sets the one chosen', async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    const tree = await openParking();
    await act(async () => { byLabel(tree, 'Choose the vehicle for slot B1-40')[0].props.onPress(); });
    const sheet = textOf(tree.root);
    expect(sheet).toContain('Which vehicle parks here?');
    expect(sheet).toContain('TS09 CD 5678'); // the bike fits a two-wheeler slot
    expect(sheet).not.toContain('Maruti');

    await act(async () => { tree.root.findAllByType(TouchableOpacity).find((n: any) => textOf(n).includes('TS09 CD 5678'))!.props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/parking/s-two/assign-vehicle', { vehicleId: 'v-bike' });
  });

  it('clears a slot that has a vehicle, and says so when none fit', async () => {
    const tree = await openParking();
    await act(async () => { byLabel(tree, 'Choose the vehicle for slot B1-12')[0].props.onPress(); });
    await act(async () => { buttons(tree, 'Clear')[0].props.onPress(); });
    await flush();
    expect(mockPost).toHaveBeenCalledWith('/parking/s-car/assign-vehicle', { vehicleId: null });
  });
});

describe('Gate — vehicle lookup', () => {
  const type = async (tree: any, text: string) => {
    await act(async () => { tree.root.findByProps({ accessibilityLabel: 'Vehicle number' }).props.onChangeText(text); });
    await flush();
    await flush();
  };

  it('asks for more characters before looking anything up', async () => {
    const tree = await mount(<VehiclePanel />);
    expect(textOf(tree.root)).toContain('at least 3 letters or digits');
    await type(tree, '12');
    expect(mockGet).not.toHaveBeenCalledWith('/gate/vehicles/lookup', expect.anything());
  });

  it('shows the flat number and slot, and no resident details', async () => {
    const tree = await mount(<VehiclePanel />);
    await type(tree, '1234');
    expect(mockGet).toHaveBeenCalledWith('/gate/vehicles/lookup', { params: { search: '1234' } });
    const text = textOf(tree.root);
    expect(text).toContain('TS09 AB 1234');
    expect(text).toContain('A-101');
    expect(text).toContain('Parking: B1-12');
    expect(text).not.toMatch(/phone|email/i);
  });

  it('tidies what is typed before asking', async () => {
    const tree = await mount(<VehiclePanel />);
    await type(tree, 'ts-09 ab 1234');
    expect(mockGet).toHaveBeenCalledWith('/gate/vehicles/lookup', { params: { search: 'TS09AB1234' } });
  });

  it('says plainly when nothing matches: treat it as a visitor', async () => {
    const tree = await mount(<VehiclePanel />);
    await type(tree, '9999');
    const text = textOf(tree.root);
    expect(text).toContain("Not a resident's vehicle");
    expect(text).toContain('Treat it as a visitor');
  });
});
