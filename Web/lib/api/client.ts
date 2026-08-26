import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/backend',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Unwrap the backend's { success: true, data: T, [meta: M] } envelope.
// Paginated responses include a top-level `meta` key: expose { data: T[], meta }.
// Single-item responses: expose the payload T directly.
api.interceptors.response.use(
  (res) => {
    if (res.data && typeof res.data === 'object' && res.data.success === true) {
      if ('meta' in res.data) {
        res.data = { data: res.data.data, meta: res.data.meta };
      } else {
        res.data = res.data.data;
      }
    }
    return res;
  },
  (err) => {
    // The BFF proxy already attempts a token refresh server-side before returning a 401.
    // By the time 401 reaches here, refresh has already failed — redirect to login.
    if (err.response?.status === 401) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
