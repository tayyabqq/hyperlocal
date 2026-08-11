import { createServer, type IncomingMessage, type Server } from 'node:http';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppOtpProvider } from '../src/auth/otp/whatsapp-otp.provider';

/**
 * Exercises the provider over a real HTTP round-trip against a local stand-in
 * for the Graph API — unlike whatsapp-otp.provider.spec.ts, nothing here
 * mocks `fetch`. This is the only place that proves the request actually
 * serializes to valid JSON, the URL path is well-formed, and headers survive
 * a real network hop. It cannot and does not touch the real Meta API.
 */
describe('WhatsAppOtpProvider (integration, local stand-in server)', () => {
  let server: Server;
  let baseUrl: string;
  let received: { path: string; authHeader: string | undefined; body: unknown }[];
  let nextStatus: number;
  let nextBody: unknown;

  function config(): ConfigService {
    return {
      getOrThrow: (key: string) =>
        ({
          WHATSAPP_PHONE_NUMBER_ID: '999888777',
          WHATSAPP_ACCESS_TOKEN: 'integration-test-token',
          WHATSAPP_AUTH_TEMPLATE_NAME: 'otp_login',
        })[key as 'WHATSAPP_PHONE_NUMBER_ID'],
      get: (key: string) =>
        ({ WHATSAPP_TEMPLATE_LANGUAGE: 'en_US', WHATSAPP_GRAPH_BASE_URL: baseUrl })[
          key as 'WHATSAPP_TEMPLATE_LANGUAGE'
        ],
    } as unknown as ConfigService;
  }

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({
          path: req.url ?? '',
          authHeader: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
        });
        res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nextBody));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    received = [];
    nextStatus = 200;
    nextBody = { messages: [{ id: 'wamid.integration' }] };
  });

  it('sends a real HTTP request Meta would accept: correct path, auth header, and body shape', async () => {
    const provider = new WhatsAppOtpProvider(config());

    await provider.sendOtp('+971509998877', '654321');

    expect(received).toHaveLength(1);
    expect(received[0].path).toBe('/999888777/messages');
    expect(received[0].authHeader).toBe('Bearer integration-test-token');
    expect(received[0].body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '971509998877',
      type: 'template',
      template: { name: 'otp_login', language: { code: 'en_US' } },
    });
  });

  it('surfaces a real 401 from the server as a generic ServiceUnavailableException', async () => {
    nextStatus = 401;
    nextBody = { error: { message: 'Invalid OAuth access token', code: 190 } };
    const provider = new WhatsAppOtpProvider(config());

    await expect(provider.sendOtp('+971509998877', '654321')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(received).toHaveLength(1); // no retry on a real received response
  });
});
