import { Injectable } from '@nestjs/common';
import type { MessageScreen, ScreenResult } from '../common/ports/message-screen.port';
import { KeywordBlacklistService } from './keyword-blacklist.service';

/**
 * The real MESSAGE_SCREEN_PORT implementation, backed by the keyword blacklist.
 * Chat resolves the port and never learns this lives in moderation.
 *
 * The block reason is deliberately generic: naming the exact term that tripped
 * would hand scammers a checklist for evading the filter.
 */
@Injectable()
export class KeywordMessageScreen implements MessageScreen {
  constructor(private readonly blacklist: KeywordBlacklistService) {}

  screen(body: string): ScreenResult {
    if (this.blacklist.firstMatch(body)) {
      return {
        allowed: false,
        reason: 'This message looks like spam or a scam and was not sent.',
      };
    }
    return { allowed: true };
  }
}
