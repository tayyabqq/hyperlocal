import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/server-config';
import { backendUnavailable } from '@/lib/backend-unavailable';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await req.json()),
    });
  } catch {
    return backendUnavailable();
  }
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
