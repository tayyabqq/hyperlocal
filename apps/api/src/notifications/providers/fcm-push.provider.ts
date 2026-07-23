import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import type {
  PushMessage,
  PushProvider,
  PushResult,
  PushTarget,
} from '../push-provider.interface';

/**
 * Firebase Cloud Messaging via the HTTP v1 API. Chosen over firebase-admin to
 * keep the dependency light: this needs only an OAuth token minted from the
 * service account, which google-auth-library caches and refreshes.
 *
 * FCM v1 sends one token per request, so a fan-out is N calls — acceptable at
 * MVP scale where a user has one or two devices. UNREGISTERED / invalid-argument
 * responses mean the token is dead and are returned for pruning.
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);
  private readonly auth: GoogleAuth;
  private readonly projectId: string;

  constructor(config: ConfigService) {
    this.projectId = config.getOrThrow<string>('FCM_PROJECT_ID');
    const credentials = JSON.parse(
      config.getOrThrow<string>('FCM_SERVICE_ACCOUNT_JSON'),
    ) as Record<string, unknown>;
    this.auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
  }

  async send(targets: PushTarget[], message: PushMessage): Promise<PushResult> {
    if (targets.length === 0) return { invalidTokens: [] };

    let accessToken: string | null | undefined;
    try {
      accessToken = (await this.auth.getAccessToken()) ?? undefined;
    } catch (error) {
      this.logger.error(`Could not mint an FCM access token: ${String(error)}`);
      return { invalidTokens: [] };
    }

    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;
    const invalidTokens: string[] = [];

    await Promise.all(
      targets.map(async (target) => {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token: target.token,
                notification: { title: message.title, body: message.body },
                data: message.data ?? {},
                android: { priority: 'high' },
              },
            }),
          });

          if (res.status === 404 || res.status === 400) {
            invalidTokens.push(target.token);
            this.logger.warn(`Pruning dead FCM token ${target.token.slice(0, 12)}… (${res.status}).`);
          } else if (!res.ok) {
            this.logger.error(`FCM send failed (${res.status}): ${await res.text()}`);
          }
        } catch (error) {
          this.logger.error(`FCM send threw: ${String(error)}`);
        }
      }),
    );

    return { invalidTokens };
  }
}
