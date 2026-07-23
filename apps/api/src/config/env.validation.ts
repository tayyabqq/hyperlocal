import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  JWT_PRIVATE_KEY!: string;

  @IsString()
  JWT_PUBLIC_KEY!: string;

  @IsIn(['console', 'whatsapp'])
  OTP_PROVIDER!: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_OTP_TEMPLATE_NAME?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsIn(['manual', 'paytabs'])
  PAYMENT_GATEWAY!: string;

  /** Where the gateway sends the user once the hosted page is done. */
  @IsString()
  PAYMENT_RETURN_URL!: string;

  @IsOptional()
  @IsString()
  PAYMENT_CALLBACK_URL?: string;

  @IsOptional()
  @IsString()
  PAYTABS_BASE_URL?: string;

  @IsOptional()
  @IsString()
  PAYTABS_PROFILE_ID?: string;

  @IsOptional()
  @IsString()
  PAYTABS_SERVER_KEY?: string;

  /** Public origin of this API; the sandbox gateway builds its redirect from it. */
  @IsOptional()
  @IsString()
  API_PUBLIC_URL?: string;

  /** Free listings granted to a user on their first post. 0 disables the launch offer. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  LAUNCH_FREE_LISTING_CREDITS?: number;

  /** Max listings per account per rolling week. 0 disables the cap. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  WEEKLY_LISTING_LIMIT?: number;

  @IsIn(['console', 'fcm'])
  PUSH_PROVIDER!: string;

  @IsOptional()
  @IsString()
  FCM_PROJECT_ID?: string;

  /** Firebase service-account JSON. Load from AWS Secrets Manager in production. */
  @IsOptional()
  @IsString()
  FCM_SERVICE_ACCOUNT_JSON?: string;
}

/** Fails fast at boot rather than at first request. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    const detail = errors
      .map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  if (parsed.NODE_ENV === 'production' && parsed.OTP_PROVIDER === 'console') {
    throw new Error('OTP_PROVIDER=console is not permitted when NODE_ENV=production');
  }
  if (parsed.OTP_PROVIDER === 'whatsapp') {
    const missing = (
      ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_OTP_TEMPLATE_NAME'] as const
    ).filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new Error(`OTP_PROVIDER=whatsapp requires: ${missing.join(', ')}`);
    }
  }

  // The manual gateway settles orders without taking money. Booting with it in
  // production would make every listing free, so it is refused outright.
  if (parsed.NODE_ENV === 'production' && parsed.PAYMENT_GATEWAY === 'manual') {
    throw new Error('PAYMENT_GATEWAY=manual is not permitted when NODE_ENV=production');
  }
  if (parsed.PAYMENT_GATEWAY === 'paytabs') {
    const missing = (
      [
        'PAYTABS_BASE_URL',
        'PAYTABS_PROFILE_ID',
        'PAYTABS_SERVER_KEY',
        'PAYMENT_CALLBACK_URL',
      ] as const
    ).filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new Error(`PAYMENT_GATEWAY=paytabs requires: ${missing.join(', ')}`);
    }
  }
  if (parsed.PAYMENT_GATEWAY === 'manual' && !parsed.API_PUBLIC_URL) {
    throw new Error('PAYMENT_GATEWAY=manual requires: API_PUBLIC_URL');
  }

  // console push logs instead of delivering; harmless in production but useless,
  // and its presence there usually means a misconfiguration, so it is refused.
  if (parsed.NODE_ENV === 'production' && parsed.PUSH_PROVIDER === 'console') {
    throw new Error('PUSH_PROVIDER=console is not permitted when NODE_ENV=production');
  }
  if (parsed.PUSH_PROVIDER === 'fcm') {
    const missing = (['FCM_PROJECT_ID', 'FCM_SERVICE_ACCOUNT_JSON'] as const).filter(
      (k) => !parsed[k],
    );
    if (missing.length > 0) {
      throw new Error(`PUSH_PROVIDER=fcm requires: ${missing.join(', ')}`);
    }
  }

  return parsed;
}
