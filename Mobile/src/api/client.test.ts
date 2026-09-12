/**
 * The response interceptor is the one piece of client-side logic a bug in
 * would be invisible until production: a duplicate refresh call burns the
 * single-use refresh token rotation the API enforces (see
 * App/src/auth/auth.service.ts), leaving every request queued behind the
 * losing refresh permanently logged out. `isRefreshing`/`failedQueue` exist
 * specifically to collapse N concurrent 401s into exactly one refresh call
 * — these tests prove that collapse actually happens, rather than trusting
 * the code reads correctly.
 *
 * No real network or SecureStore involved: `tokenService` is replaced with
 * an in-memory stateful mock (mirrors the real module's shape), and
 * `apiClient`'s own transport is replaced with a custom axios `adapter` —
 * a synchronous function under our control, so "concurrent" here means
 * genuinely racing promises the same way real overlapping requests would,
 * not a simulation with artificial delays.
 */

import axios from 'axios';

jest.mock('@/auth/token.service', () => {
  const state: { access: string | null; refresh: string | null } = {
    access: 'access-1',
    refresh: 'refresh-1',
  };
  return {
    __state: state,
    tokenService: {
      getAccessToken: jest.fn(async () => state.access),
      getRefreshToken: jest.fn(async () => state.refresh),
      setTokens: jest.fn(async (accessToken: string, refreshToken: string) => {
        state.access = accessToken;
        state.refresh = refreshToken;
      }),
      clearTokens: jest.fn(async () => {
        state.access = null;
        state.refresh = null;
      }),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tokenState = (jest.requireMock('@/auth/token.service') as { __state: { access: string | null; refresh: string | null } }).__state;

import { tokenService } from '@/auth/token.service';
import apiClient, { API_BASE_URL, setAuthLogoutCallback } from './client';

/** A fake transport: `statusFor(config)` decides the response status for
 *  each outgoing request, with no real I/O. Requests default to carrying
 *  whatever `Authorization` header the interceptors attached, captured on
 *  the resolved response's own config so tests can inspect it.
 *
 *  Rejecting non-2xx statuses is normally done by axios's *built-in*
 *  adapters (xhr/http) calling `settle()` internally — dispatchRequest
 *  itself just awaits whatever the adapter resolves to. A custom adapter
 *  is responsible for that decision itself, so this replicates it: resolve
 *  for 2xx, throw an AxiosError-shaped rejection otherwise, exactly what
 *  the response interceptor under test expects to see. */
function useFakeTransport(statusFor: (config: any) => number) {
  apiClient.defaults.adapter = jest.fn(async (config: any) => {
    const status = statusFor(config);
    const response = {
      status,
      statusText: status === 200 ? 'OK' : 'Unauthorized',
      data: status === 200 ? { ok: true } : { message: 'Unauthorized' },
      headers: {},
      config,
    };
    if (status >= 200 && status < 300) return response;
    const err: any = new Error(`Request failed with status code ${status}`);
    err.isAxiosError = true;
    err.response = response;
    err.config = config;
    throw err;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  tokenState.access = 'access-1';
  tokenState.refresh = 'refresh-1';
  setAuthLogoutCallback(() => {});
});

describe('apiClient request interceptor', () => {
  it("attaches the current access token to every outgoing request", async () => {
    let seenAuth: string | undefined;
    useFakeTransport((config) => {
      seenAuth = config.headers.Authorization;
      return 200;
    });

    await apiClient.get('/whoami');

    expect(seenAuth).toBe('Bearer access-1');
  });
});

describe('apiClient response interceptor — single 401', () => {
  it('refreshes exactly once and retries the original request with the new token', async () => {
    useFakeTransport((config) => (config._retry ? 200 : 401));
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } },
    });

    const res = await apiClient.get('/protected');

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(`${API_BASE_URL}/auth/refresh`, { refreshToken: 'refresh-1' });
    expect(tokenService.setTokens).toHaveBeenCalledWith('access-2', 'refresh-2');
    // The retry re-runs the request interceptor, which re-reads the (now
    // updated) access token — proving the retry actually used the new one,
    // not the stale header set by hand in the catch block.
    expect((res.config as any).headers.Authorization).toBe('Bearer access-2');
  });

  it('never retries a request that already carries _retry — no infinite refresh loop', async () => {
    useFakeTransport(() => 401);
    jest.spyOn(axios, 'post');

    await expect(
      apiClient.get('/protected', { ...( { _retry: true } as any) }),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('apiClient response interceptor — concurrent 401s', () => {
  it('collapses 5 simultaneous 401s into exactly one refresh call, resolving every queued request', async () => {
    useFakeTransport((config) => (config._retry ? 200 : 401));
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => apiClient.get(`/protected-${i}`)),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1); // not 5 — the queue actually collapsed the race
    expect(tokenService.setTokens).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh clears tokens, logs out exactly once, and rejects every queued request — never a partial retry storm', async () => {
    useFakeTransport(() => 401); // every request (including any retry) still 401s
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh token expired'));
    const logout = jest.fn();
    setAuthLogoutCallback(logout);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => apiClient.get(`/protected-${i}`)),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1); // one refresh attempt, not one per queued request
    expect(tokenService.clearTokens).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('recovers cleanly on the next request after a failed refresh (isRefreshing does not get stuck true)', async () => {
    useFakeTransport(() => 401);
    jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('refresh token expired'));
    setAuthLogoutCallback(jest.fn());

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();

    // The failed refresh clears both tokens (real behaviour: the user is
    // logged out). Simulate them logging back in — a fresh refresh token
    // to work with — before the next request; this test's actual point is
    // that isRefreshing was correctly reset to false by the earlier
    // failure's `finally`, not stuck true and hanging this request behind
    // a queue nothing will ever drain.
    tokenState.access = 'access-3';
    tokenState.refresh = 'refresh-3';
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { data: { accessToken: 'access-4', refreshToken: 'refresh-4' } },
    });
    useFakeTransport((config) => (config._retry ? 200 : 401));

    const res = await apiClient.get('/protected-again');
    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
