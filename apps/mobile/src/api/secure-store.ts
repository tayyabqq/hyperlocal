import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'hl_refresh_token';

/** Keychain on iOS, Keystore-backed encrypted prefs on Android. */
export const tokenStore = {
  get: (): Promise<string | null> => SecureStore.getItemAsync(REFRESH_KEY),
  set: (token: string): Promise<void> => SecureStore.setItemAsync(REFRESH_KEY, token),
  clear: (): Promise<void> => SecureStore.deleteItemAsync(REFRESH_KEY),
};
