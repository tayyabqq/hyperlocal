import { NextResponse } from 'next/server';
import { ErrorCode } from '@hl/shared';

/**
 * The backend fetch itself failed (DNS, connection refused, timeout) rather
 * than the backend answering with an error status. Without this, an
 * unreachable API crashes the whole serverless function (Vercel's generic
 * 500 page) instead of returning the app's normal error shape the client
 * already knows how to render.
 */
export function backendUnavailable(): NextResponse {
  return NextResponse.json(
    {
      errorCode: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Could not reach the server right now. Please try again.',
    },
    { status: 503 },
  );
}
