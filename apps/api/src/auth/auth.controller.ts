import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthTokens, RequestOtpResult, VerifyOtpResult } from '@hl/shared';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

/**
 * OTP sends cost money and attract pumping fraud, so production keeps a tight
 * per-IP cap. In local dev every request shares 127.0.0.1, so that cap trips
 * almost immediately under normal testing — there the flow is effectively
 * unthrottled. NODE_ENV=production is a real container env var in the ECS/Docker
 * runtime, so this evaluates correctly at import time and cannot weaken prod.
 * The per-phone 60s resend cooldown in AuthService still applies in every env.
 */
const IS_PROD = process.env.NODE_ENV === 'production';
const OTP_REQUEST_THROTTLE = IS_PROD
  ? { default: { limit: 5, ttl: 600_000 } }
  : { default: { limit: 1000, ttl: 60_000 } };
const OTP_VERIFY_THROTTLE = IS_PROD
  ? { default: { limit: 10, ttl: 600_000 } }
  : { default: { limit: 1000, ttl: 60_000 } };

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Tightest limit in the system (production); relaxed in dev — see above. */
  @Throttle(OTP_REQUEST_THROTTLE)
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestOtpDto): Promise<RequestOtpResult> {
    return this.auth.requestOtp(dto.phoneE164);
  }

  @Throttle(OTP_VERIFY_THROTTLE)
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<VerifyOtpResult> {
    return this.auth.verifyOtp(dto.challengeId, dto.phoneE164, dto.code);
  }

  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user.id);
  }
}
