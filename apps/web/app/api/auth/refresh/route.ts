import { NextResponse, type NextRequest } from 'next/server';
import type { AuthTokens } from '@hl/shared';
import { apiBaseUrl, REFRESH_COOKIE, refreshCookieOptions } from '@/lib/server-config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { errorCode: 'NO_SESSION', message: 'No active session' },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${apiBaseUrl()}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  const body = await upstream.json();
  if (!upstream.ok) {
    const res = NextResponse.json(body, { status: upstream.status });
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  const tokens = body as AuthTokens;
  const res = NextResponse.json({
    accessToken: tokens.accessToken,
    expiresInSeconds: tokens.expiresInSeconds,
  });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
  return res;
}
