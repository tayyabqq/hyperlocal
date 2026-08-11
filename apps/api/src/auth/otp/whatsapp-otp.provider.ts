import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@hl/shared';
import type { OtpProvider } from './otp-provider.interface';

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LANGUAGE = 'en_US';

/** Meta's documented error envelope for the Graph API. Fields are all optional because a network-layer failure never has one. */
interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * WhatsApp Business Cloud API delivery. Requires an approved template in the
 * "AUTHENTICATION" category; Meta rejects OTP sends on any other category.
 *
 * Retries exactly once, and only for failures where no response was ever
 * received (timeout, DNS, connection reset) — never after Meta has actually
 * answered, even with an error, because a 5xx does not prove the message
 * wasn't already queued. Retrying an ambiguous outcome risks sending the
 * user two OTP messages for one login attempt.
 */
@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  private readonly logger = new Logger(WhatsAppOtpProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const phoneNumberId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    const template = this.config.getOrThrow<string>('WHATSAPP_AUTH_TEMPLATE_NAME');
    const language = this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE') ?? DEFAULT_LANGUAGE;
    // Overridable only so integration tests can point this at a local stand-in
    // server instead of the real Graph API; never set in any real environment.
    const graphBaseUrl =
      this.config.get<string>('WHATSAPP_GRAPH_BASE_URL') ?? 'https://graph.facebook.com/v21.0';

    const url = `${graphBaseUrl}/${phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneE164.replace('+', ''),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            // The "copy code" quick-reply button Meta's auth templates use —
            // it also carries the code so the button can autofill it.
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    });

    let response: Response;
    try {
      response = await this.postWithTimeout(url, accessToken, body);
    } catch (firstError) {
      this.logger.warn(
        `WhatsApp send to ${phoneNumberId} got no response (${describeNetworkError(firstError)}); retrying once.`,
      );
      try {
        response = await this.postWithTimeout(url, accessToken, body);
      } catch (secondError) {
        this.logger.error(
          `WhatsApp send failed twice with no response: ${describeNetworkError(secondError)}`,
        );
        throw deliveryFailed();
      }
    }

    if (!response.ok) {
      const detail = await parseMetaError(response);
      this.logger.error(
        `WhatsApp delivery rejected (HTTP ${response.status}): code=${detail.code ?? 'n/a'} ` +
          `subcode=${detail.subcode ?? 'n/a'} message=${detail.message ?? 'n/a'} trace=${detail.traceId ?? 'n/a'}`,
      );
      throw deliveryFailed();
    }
  }

  private async postWithTimeout(url: string, accessToken: string, body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function deliveryFailed(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    errorCode: ErrorCode.OTP_DELIVERY_FAILED,
    message: 'Could not send your code right now. Please try again.',
  });
}

function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timed out';
  return error instanceof Error ? error.message : String(error);
}

/** Never throws — a malformed error body must not itself crash error handling. */
async function parseMetaError(
  response: Response,
): Promise<{ code?: number; subcode?: number; message?: string; traceId?: string }> {
  try {
    const parsed = (await response.json()) as MetaErrorBody;
    return {
      code: parsed.error?.code,
      subcode: parsed.error?.error_subcode,
      message: parsed.error?.message,
      traceId: parsed.error?.fbtrace_id,
    };
  } catch {
    return {};
  }
}
