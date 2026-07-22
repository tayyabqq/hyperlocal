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

/** Authenticated call straight to the API. Bearer, not cookies — no CSRF surface. */
export async function apiFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

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
