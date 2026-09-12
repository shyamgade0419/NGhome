import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import Constants from 'expo-constants';
import { tokenService } from '@/auth/token.service';

export const API_BASE_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ?? 'https://nghome-api.novagade.in/api/v1';

let authLogoutCallback: (() => void) | null = null;

export function setAuthLogoutCallback(cb: () => void) {
  authLogoutCallback = cb;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Attach access token to every request
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await tokenService.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

// Refresh token on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      // Mark this queued request as already-retried too, not just the one
      // that actually triggers the refresh. Without this, a request that
      // waits in the queue and then gets retried with the fresh token has
      // no `_retry` flag: if that retry somehow 401s again (the new token
      // turns out to already be stale, a race with a refresh triggered
      // elsewhere, a transient server hiccup), the check above sees a
      // "fresh" 401 and walks straight back into another refresh cycle —
      // isRefreshing has by then been reset to false by the original
      // refresh's own `finally`, so this looks like a brand new failure
      // rather than a retry that already happened. Setting it here closes
      // that: a second 401 on a queued request's retry fails cleanly
      // instead of triggering a redundant refresh (which, against a
      // single-use rotating refresh token, is not merely wasteful — it can
      // outright fail if another legitimate refresh already rotated the
      // token this one still thinks is current).
      originalRequest._retry = true;
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return apiClient(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await tokenService.getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token');

      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
      const { accessToken, refreshToken: newRefresh } = response.data.data;

      await tokenService.setTokens(accessToken, newRefresh);
      processQueue(null, accessToken);

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await tokenService.clearTokens();
      authLogoutCallback?.();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
