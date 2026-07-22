import { Injectable, Logger } from '@nestjs/common';
import type { OtpProvider } from './otp-provider.interface';

/**
 * Development delivery: writes the code to the log instead of sending it.
 * Boot-time env validation refuses this provider when NODE_ENV=production.
 */
@Injectable()
export class ConsoleOtpProvider implements OtpProvider {
  private readonly logger = new Logger('OtpDev');

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    this.logger.warn(`DEV OTP for ${phoneE164}: ${code}`);
  }
}
