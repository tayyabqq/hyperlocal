jest.mock('./config', () => ({ apiBaseUrl: () => 'https://api.example' }));

import { ApiError, authedFetch, registerRefreshHandler } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('authedFetch', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    registerRefreshHandler(null);
    jest.clearAllMocks();
  });

  it('returns the body on a successful call without touching the refresh handler', async () => {
    const refreshHandler = jest.fn();
    registerRefreshHandler(refreshHandler);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await authedFetch<{ ok: boolean }>('/v1/users/me', 'token-1');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshHandler).not.toHaveBeenCalled();
  });

  it('retries once with a fresh token when the access token has expired', async () => {
    registerRefreshHandler(() => Promise.resolve('token-2'));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { errorCode: 'UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await authedFetch<{ ok: boolean }>('/v1/users/me', 'token-1');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-2');
  });

  it('throws the original 401 when no refresh handler is registered', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { errorCode: 'UNAUTHORIZED' }));

    await expect(authedFetch('/v1/users/me', 'token-1')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the original 401 when the refresh handler cannot produce a new token', async () => {
    registerRefreshHandler(() => Promise.resolve(null));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { errorCode: 'UNAUTHORIZED' }));

    await expect(authedFetch('/v1/users/me', 'token-1')).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
