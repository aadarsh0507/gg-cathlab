import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({ baseURL: API_BASE_URL });

// Internal-network tool: JWT is kept in localStorage for simplicity (survives page
// refresh without a re-login flow). Tradeoff: vulnerable to XSS token theft, which
// would be unacceptable for a public-facing app but is an accepted risk here since
// this only runs on the hospital LAN behind existing network access controls.
const TOKEN_KEY = 'cathlab_billing_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

export function extractErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error || err.message || fallback;
  }
  return fallback;
}

// File-serving endpoints require the Bearer token, so a plain <a href> can't be
// used directly — fetch as a blob (auth header attached via the request
// interceptor above) and open it in a new tab via an object URL.
export async function openAuthenticatedFile(path: string): Promise<void> {
  const response = await apiClient.get(path, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(response.data);
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
