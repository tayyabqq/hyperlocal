import Constants from 'expo-constants';

/**
 * Android emulators reach the host machine on 10.0.2.2, not localhost. For a
 * physical device, set EXPO_PUBLIC_API_BASE_URL to your machine's LAN IP
 * before running `expo start` (see app.config.ts).
 */
export function apiBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured (see apps/mobile/app.config.ts)');
  }
  return url;
}

export function mapboxAccessToken(): string {
  const token = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      'EXPO_PUBLIC_MAPBOX_TOKEN is not configured (see apps/mobile/app.config.ts)',
    );
  }
  return token;
}
