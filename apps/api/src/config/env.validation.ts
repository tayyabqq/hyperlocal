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

  // This is the "WHATSAPP_PROVIDER" switch: OTP is the only channel it
  // currently delivers, so one variable covers both provider selection and
  // the OTP channel. A second, WhatsApp-specific toggle would just duplicate it.
  @IsIn(['console', 'whatsapp'])
  OTP_PROVIDER!: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  /** Must be an approved template in Meta's AUTHENTICATION category — see docs/DEPLOYMENT.md. */
  @IsOptional()
  @IsString()
  WHATSAPP_AUTH_TEMPLATE_NAME?: string;

  /** Meta locale code, e.g. en_US. Defaults to en_US in the provider if unset. */
  @IsOptional()
  @IsString()
  WHATSAPP_TEMPLATE_LANGUAGE?: string;

  /**
   * Not required to send messages (the Cloud API sends are addressed by
   * WHATSAPP_PHONE_NUMBER_ID alone) — only needed if you later call the
   * Business Manager API to manage templates programmatically. Recorded here
   * for ops reference, not read by the provider.
   */
  @IsOptional()
  @IsString()
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;

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

  /** Error tracking. Optional everywhere; when unset, Sentry stays uninitialised. */
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsIn(['local', 's3'])
  STORAGE_PROVIDER!: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  /** CDN in front of the bucket, if any. Falls back to the bucket's own regional endpoint. */
  @IsOptional()
  @IsString()
  S3_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;
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
      ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_AUTH_TEMPLATE_NAME'] as const
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

  // Local disk storage lives on the ECS task's ephemeral, per-instance
  // filesystem — a second request hitting a different task would 404 on an
  // image the first task saved. Never permitted in production.
  if (parsed.NODE_ENV === 'production' && parsed.STORAGE_PROVIDER === 'local') {
    throw new Error('STORAGE_PROVIDER=local is not permitted when NODE_ENV=production');
  }
  if (parsed.STORAGE_PROVIDER === 's3') {
    const missing = (['S3_BUCKET', 'S3_REGION'] as const).filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new Error(`STORAGE_PROVIDER=s3 requires: ${missing.join(', ')}`);
    }
  }

  return parsed;
}
