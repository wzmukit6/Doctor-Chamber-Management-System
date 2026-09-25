import type { ApiFailure, ErrorCode, PageMeta } from '@chamber/shared';

export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const CSRF_COOKIE = 'ca_csrf';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly details: { path: string; message: string }[] = [],
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Lets the auth store react when the server says the session is gone. */
export function onUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<{ data: T; meta?: PageMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check your connection.');
  }

  const json = (await res.json().catch(() => null)) as { success: true; data: T; meta?: PageMeta } | ApiFailure | null;
  if (!res.ok || !json || json.success === false) {
    const failure = json && json.success === false ? json.error : null;
    const err = new ApiError(
      res.status,
      failure?.code ?? 'INTERNAL_ERROR',
      failure?.message ?? 'Unexpected server response',
      failure?.details ?? [],
      failure?.data,
    );
    if (res.status === 401 && !path.startsWith('/auth/login')) unauthorizedListeners.forEach((l) => l());
    throw err;
  }
  return { data: json.data, meta: json.meta };
}

export const api = {
  get: async <T>(path: string, query?: Query) => (await request<T>('GET', path, undefined, query)).data,
  page: async <T>(path: string, query?: Query) => {
    const { data, meta } = await request<T[]>('GET', path, undefined, query);
    return { items: data, meta: meta! };
  },
  post: async <T>(path: string, body: unknown = {}) => (await request<T>('POST', path, body)).data,
  patch: async <T>(path: string, body: unknown) => (await request<T>('PATCH', path, body)).data,
  put: async <T>(path: string, body: unknown) => (await request<T>('PUT', path, body)).data,
  delete: async <T>(path: string, body?: unknown) => (await request<T>('DELETE', path, body ?? {})).data,
};
