import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsAppOtpProvider } from '../src/auth/otp/whatsapp-otp.provider';

const CONFIG = {
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_ACCESS_TOKEN: 'test-access-token-should-never-appear-in-logs-or-errors',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'otp_login',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('WhatsAppOtpProvider', () => {
  let provider: WhatsAppOtpProvider;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsAppOtpProvider,
        { provide: ConfigService, useValue: { getOrThrow: (k: keyof typeof CONFIG) => CONFIG[k], get: (k: keyof typeof CONFIG) => CONFIG[k] } },
      ],
    }).compile();

    provider = moduleRef.get(WhatsAppOtpProvider);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('sends a correctly-shaped authentication template request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.abc' }] }));

    await provider.sendOtp('+971501234567', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${CONFIG.WHATSAPP_ACCESS_TOKEN}`);

    const body = JSON.parse(init.body);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('971501234567'); // no leading '+'
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('otp_login');
    expect(body.template.language).toEqual({ code: 'en_US' });
    expect(body.template.components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: '123456' }],
    });
  });

  it('never leaks the access token or the OTP itself in a thrown error on failure', async () => {
    expect.assertions(3);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Invalid OAuth access token', code: 190 } }),
    );

    try {
      await provider.sendOtp('+971501234567', '123456');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const serialized = JSON.stringify((error as ServiceUnavailableException).getResponse());
      expect(serialized).not.toContain(CONFIG.WHATSAPP_ACCESS_TOKEN);
      expect(serialized).not.toContain('123456'); // the OTP itself
    }
  });

  it('throws a generic error on a rejected template send, without retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: { message: 'Template not approved', code: 132001 } }),
    );

    await expect(provider.sendOtp('+971501234567', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
    // A received response — even an error one — must not trigger a retry:
    // Meta may have already queued the message despite answering with an error.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on a network-level failure with no response, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.retry' }] }));

    await provider.sendOtp('+971501234567', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second consecutive network-level failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed again'));

    await expect(provider.sendOtp('+971501234567', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a timeout (AbortError) as a network-level failure eligible for one retry', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.after-timeout' }] }));

    await provider.sendOtp('+971501234567', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
