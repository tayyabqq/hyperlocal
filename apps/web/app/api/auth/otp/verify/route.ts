import { NextResponse, type NextRequest } from 'next/server';
import type { VerifyOtpResult } from '@hl/shared';
import { apiBaseUrl, REFRESH_COOKIE, refreshCookieOptions } from '@/lib/server-config';
import { backendUnavailable } from '@/lib/backend-unavailable';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await req.json()),
    });
  } catch {
    return backendUnavailable();
  }

  const body = await upstream.json();
  if (!upstream.ok) return NextResponse.json(body, { status: upstream.status });

  const result = body as VerifyOtpResult;

  // The refresh token is deliberately withheld from the JSON payload: it lives
  // only in an httpOnly cookie, so XSS cannot read it.
  const res = NextResponse.json({
    accessToken: result.tokens.accessToken,
    expiresInSeconds: result.tokens.expiresInSeconds,
    user: result.user,
    isNewUser: result.isNewUser,
  });
  res.cookies.set(REFRESH_COOKIE, result.tokens.refreshToken, refreshCookieOptions());
  return res;
}
