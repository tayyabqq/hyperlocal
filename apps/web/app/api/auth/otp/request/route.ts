import { NextResponse, type NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/server-config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const upstream = await fetch(`${apiBaseUrl()}/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
