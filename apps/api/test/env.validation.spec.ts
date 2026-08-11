import 'reflect-metadata';
import { validateEnv } from '../src/config/env.validation';

const BASE = {
  NODE_ENV: 'production',
  PORT: 3000,
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  JWT_PRIVATE_KEY: 'x',
  JWT_PUBLIC_KEY: 'x',
  PAYMENT_GATEWAY: 'paytabs',
  PAYMENT_RETURN_URL: 'https://x',
  PAYTABS_BASE_URL: 'https://x',
  PAYTABS_PROFILE_ID: 'x',
  PAYTABS_SERVER_KEY: 'x',
  PAYMENT_CALLBACK_URL: 'https://x',
  PUSH_PROVIDER: 'fcm',
  FCM_PROJECT_ID: 'x',
  FCM_SERVICE_ACCOUNT_JSON: 'x',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'x',
  S3_REGION: 'x',
};

describe('validateEnv — WhatsApp OTP requirements', () => {
  it('refuses OTP_PROVIDER=console in production', () => {
    expect(() => validateEnv({ ...BASE, OTP_PROVIDER: 'console' })).toThrow(
      /OTP_PROVIDER=console is not permitted when NODE_ENV=production/,
    );
  });

  it('refuses OTP_PROVIDER=whatsapp with no WhatsApp credentials at all', () => {
    expect(() => validateEnv({ ...BASE, OTP_PROVIDER: 'whatsapp' })).toThrow(
      /OTP_PROVIDER=whatsapp requires/,
    );
  });

  it('refuses OTP_PROVIDER=whatsapp missing just the auth template name', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        OTP_PROVIDER: 'whatsapp',
        WHATSAPP_PHONE_NUMBER_ID: 'x',
        WHATSAPP_ACCESS_TOKEN: 'x',
      }),
    ).toThrow(/WHATSAPP_AUTH_TEMPLATE_NAME/);
  });

  it('accepts OTP_PROVIDER=whatsapp with the full, correctly-named credential set', () => {
    expect(() =>
      validateEnv({
        ...BASE,
        OTP_PROVIDER: 'whatsapp',
        WHATSAPP_PHONE_NUMBER_ID: 'x',
        WHATSAPP_ACCESS_TOKEN: 'x',
        WHATSAPP_AUTH_TEMPLATE_NAME: 'otp_login',
        WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
      }),
    ).not.toThrow();
  });

  it('does not require WHATSAPP_BUSINESS_ACCOUNT_ID — the send API never uses it', () => {
    const result = validateEnv({
      ...BASE,
      OTP_PROVIDER: 'whatsapp',
      WHATSAPP_PHONE_NUMBER_ID: 'x',
      WHATSAPP_ACCESS_TOKEN: 'x',
      WHATSAPP_AUTH_TEMPLATE_NAME: 'otp_login',
    });
    expect(result.WHATSAPP_BUSINESS_ACCOUNT_ID).toBeUndefined();
  });
});
