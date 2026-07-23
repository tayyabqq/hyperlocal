import { Injectable, Logger } from '@nestjs/common';
import type {
  PushMessage,
  PushProvider,
  PushResult,
  PushTarget,
} from '../push-provider.interface';

/**
 * Development delivery: logs the notification instead of sending it, mirroring
 * ConsoleOtpProvider. Boot-time env validation refuses this provider when
 * NODE_ENV=production.
 */
@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('PushDev');

  send(targets: PushTarget[], message: PushMessage): Promise<PushResult> {
    for (const target of targets) {
      this.logger.log(
        `PUSH -> ${target.token.slice(0, 12)}… (${target.platform}): ${message.title} — ${message.body}`,
      );
    }
    return Promise.resolve({ invalidTokens: [] });
  }
}
