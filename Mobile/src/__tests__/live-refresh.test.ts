/**
 * What keeps the screens current: coming back to the app, the network returning, and a push arriving all refetch.
 */
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';

let mockAppStateHandler: ((s: string) => void) | undefined;
let mockNetHandler: ((s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) | undefined;
let mockReceivedHandler: (() => void) | undefined;
const mockRemoveApp = jest.fn();
const mockRemoveNet = jest.fn();
const mockRemoveReceived = jest.fn();

jest.mock('react-native', () => ({
  AppState: { addEventListener: (_: string, h: (s: string) => void) => { mockAppStateHandler = h; return { remove: mockRemoveApp }; } },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: (h: any) => { mockNetHandler = h; return mockRemoveNet; } },
}));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (h: () => void) => { mockReceivedHandler = h; return { remove: mockRemoveReceived }; },
}));

import { isOnline, startLiveRefresh } from '@/query/liveRefresh';

describe('live refresh', () => {
  let qc: QueryClient;
  let stop: () => void;

  beforeEach(() => {
    qc = new QueryClient();
    jest.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    stop = startLiveRefresh(qc);
  });
  afterEach(() => {
    stop();
    jest.restoreAllMocks();
  });

  it('counts the app coming to the front as focus, and going to the background as losing it', () => {
    mockAppStateHandler?.('background');
    expect(focusManager.isFocused()).toBe(false);
    mockAppStateHandler?.('active');
    expect(focusManager.isFocused()).toBe(true);
  });

  it('reads connectivity from the phone', () => {
    mockNetHandler?.({ isConnected: false, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);
    mockNetHandler?.({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('refetches everything when a push arrives', () => {
    mockReceivedHandler?.();
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('stops listening for pushes when torn down', () => {
    stop();
    expect(mockRemoveReceived).toHaveBeenCalled();
  });
});

describe('isOnline', () => {
  it('is online while connectivity is unknown, so a slow check does not freeze the app', () => {
    expect(isOnline({ isConnected: null, isInternetReachable: null })).toBe(true);
    expect(isOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
  });
  it('is offline when disconnected or the internet is unreachable', () => {
    expect(isOnline({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(isOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
