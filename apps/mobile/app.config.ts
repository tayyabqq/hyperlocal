import type { ExpoConfig } from 'expo/config';

/**
 * Dynamic config so EAS build profiles can each point at a different API and
 * Mapbox token (dev emulator vs. a real preview/production backend). A static
 * app.json has no way to vary `extra` per build profile — every APK/AAB would
 * otherwise embed the same hardcoded 10.0.2.2 emulator loopback address.
 *
 * Local `expo start` still works with zero config: the fallbacks below match
 * what app.json previously hardcoded. Real builds set these in eas.json's
 * per-profile `env`.
 */
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:3000';
const mapboxAccessToken =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? 'REPLACE_WITH_MAPBOX_PUBLIC_TOKEN';
const mapboxDownloadToken =
  process.env.RNMAPBOX_DOWNLOAD_TOKEN ?? 'REPLACE_WITH_MAPBOX_DOWNLOAD_TOKEN';

const config: ExpoConfig = {
  name: 'Work Nearby',
  slug: 'work-nearby',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  splash: {
    backgroundColor: '#F7F5F1',
    resizeMode: 'contain',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'ae.worknearby.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'We use your location to show nearby job listings and set the pin when you post one.',
    },
  },
  android: {
    package: 'ae.worknearby.app',
    adaptiveIcon: {
      backgroundColor: '#14213D',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
  extra: {
    apiBaseUrl,
    mapboxAccessToken,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
  plugins: [
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: mapboxDownloadToken,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#14213D',
      },
    ],
  ],
};

export default config;
