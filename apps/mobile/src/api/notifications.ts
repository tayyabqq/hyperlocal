import { DevicePlatform, type RegisterDeviceBody } from '@hl/shared';
import { authedFetch } from './client';

export function registerDevice(
  accessToken: string,
  token: string,
  platform: DevicePlatform,
): Promise<void> {
  const body: RegisterDeviceBody = { token, platform };
  return authedFetch<void>('/v1/notifications/devices', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function unregisterDevice(accessToken: string, token: string): Promise<void> {
  return authedFetch<void>('/v1/notifications/devices', accessToken, {
    method: 'DELETE',
    body: JSON.stringify({ token, platform: DevicePlatform.ANDROID }),
  });
}
