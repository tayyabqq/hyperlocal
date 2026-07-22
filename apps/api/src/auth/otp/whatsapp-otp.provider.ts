import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@hl/shared';
import type { OtpProvider } from './otp-provider.interface';

/**
 * WhatsApp Business Cloud API delivery. Requires an approved template in the
 * "authentication" category; Meta rejects OTP sends on any other category.
 */
@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  private readonly logger = new Logger(WhatsAppOtpProvider.name);
  private readonly graphBaseUrl = 'https://graph.facebook.com/v21.0';

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const phoneNumberId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    const template = this.config.getOrThrow<string>('WHATSAPP_OTP_TEMPLATE_NAME');

    const response = await fetch(`${this.graphBaseUrl}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phoneE164.replace('+', ''),
        type: 'template',
        template: {
          name: template,
          language: { code: 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: code }],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      // Log the upstream detail; return a generic failure to the caller.
      this.logger.error(`WhatsApp delivery failed (${response.status}): ${await response.text()}`);
      throw new ServiceUnavailableException({
        errorCode: ErrorCode.OTP_DELIVERY_FAILED,
        message: 'Could not send your code right now. Please try again.',
      });
    }
  }
}
