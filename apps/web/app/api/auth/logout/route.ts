import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl, REFRESH_COOKIE } from '@/lib/server-config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (auth) {
    // Best effort: the cookie is cleared regardless so the user is logged out
    // locally even if the API is unreachable.
    await fetch(`${apiBaseUrl()}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: auth },
    }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
