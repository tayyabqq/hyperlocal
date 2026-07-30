import type { ApiErrorBody } from '@hl/shared';
import { apiBaseUrl } from './config';

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

async function parse<T>(res: Response): Promise<T> {
  const body: Partial<ApiErrorBody> = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(body.message)
      ? (body.message[0] ?? 'Request failed')
      : (body.message ?? 'Request failed');
    throw new ApiError(message, res.status, body.errorCode ?? 'INTERNAL');
  }
  return body as T;
}

export async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  return parse<T>(res);
}

/**
 * The access token lives for 15 minutes, so a session left open across that
 * window will 401 on its next call. AuthContext registers its own `refresh`
 * here once, so every screen's authedFetch gets a transparent retry without
 * threading a refresh callback through every listings/payments/chat client.
 */
let refreshHandler: (() => Promise<string | null>) | null = null;

export function registerRefreshHandler(fn: (() => Promise<string | null>) | null): void {
  refreshHandler = fn;
}

function doFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

export async function authedFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let res = await doFetch(path, accessToken, init);

  if (res.status === 401 && refreshHandler) {
    const fresh = await refreshHandler();
    if (fresh) res = await doFetch(path, fresh, init);
  }

  return parse<T>(res);
}
