import type { ApiErrorBody } from '@hl/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function firstMessage(body: Partial<ApiErrorBody>): string {
  if (Array.isArray(body.message)) return body.message[0] ?? 'Request failed';
  return body.message ?? 'Request failed';
}

/**
 * The access token lives for 15 minutes, so any tab left open across that
 * window will 401 on its next call. AuthContext registers its own `refresh`
 * here once, so every caller of `apiFetch` gets a transparent retry without
 * threading a refresh callback through every listings/payments/chat client.
 */
let refreshHandler: (() => Promise<string | null>) | null = null;

export function registerRefreshHandler(fn: (() => Promise<string | null>) | null): void {
  refreshHandler = fn;
}

async function doFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

/** Authenticated call straight to the API. Bearer, not cookies — no CSRF surface. */
export async function apiFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let res = await doFetch(path, accessToken, init);

  if (res.status === 401 && refreshHandler) {
    const fresh = await refreshHandler();
    if (fresh) res = await doFetch(path, fresh, init);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(firstMessage(body), res.status, body.errorCode ?? 'INTERNAL');
  }
  return body as T;
}

async function doUpload(path: string, accessToken: string, formData: FormData): Promise<Response> {
  // No Content-Type here deliberately: the browser must set its own
  // multipart boundary, which it can only do if this key is left unset.
  return fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
}

/** Multipart upload with the same transparent 401-retry as apiFetch. */
export async function apiUpload<T>(
  path: string,
  accessToken: string,
  formData: FormData,
): Promise<T> {
  let res = await doUpload(path, accessToken, formData);

  if (res.status === 401 && refreshHandler) {
    const fresh = await refreshHandler();
    if (fresh) res = await doUpload(path, fresh, formData);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(firstMessage(body), res.status, body.errorCode ?? 'INTERNAL');
  }
  return body as T;
}

/** Calls our own Route Handlers, which hold the refresh cookie. */
export async function routeFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(firstMessage(parsed), res.status, parsed.errorCode ?? 'INTERNAL');
  }
  return parsed as T;
}
