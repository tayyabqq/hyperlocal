import Constants from 'expo-constants';

/**
 * Android emulators reach the host machine on 10.0.2.2, not localhost. For a
 * physical device set this to your machine's LAN IP in app.json.
 */
export function apiBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('expo.extra.apiBaseUrl is not configured in app.json');
  }
  return url;
}

export function mapboxAccessToken(): string {
  const token = Constants.expoConfig?.extra?.mapboxAccessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('expo.extra.mapboxAccessToken is not configured in app.json');
  }
  return token;
}
