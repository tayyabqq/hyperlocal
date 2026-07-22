export const REFRESH_COOKIE = 'hl_rt';
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error('API_BASE_URL is not set');
  return url;
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    // Scoped so the token is only ever sent to our own auth routes.
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  };
}
