import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ErrorCode, type CreditBalance, type PaymentOrderSummary } from '@hl/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreditsService } from './credits.service';
import { PaymentsService } from './payments.service';

@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Gateway callback. Unauthenticated by design — the signature over the raw
   * body is the authentication. The throttle ceiling is high because
   * rate-limiting this endpoint means dropping payment confirmations.
   */
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(200)
  @Post('callback')
  async callback(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    if (!req.rawBody) {
      throw new BadRequestException({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'Missing request body.',
      });
    }

    const signature = req.header('signature') ?? req.header('x-paytabs-signature');
    await this.payments.handleGatewayCallback(req.rawBody, signature);
    return { received: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:id')
  order(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentOrderSummary> {
    return this.payments.findOrderForUser(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('listings/:listingId/order')
  orderForListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<PaymentOrderSummary> {
    return this.payments.latestOrderForListing(listingId, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('credits')
  async creditBalance(@CurrentUser() user: AuthenticatedUser): Promise<CreditBalance> {
    return { credits: await this.credits.balanceOf(user.id) };
  }

  /**
   * Stands in for the hosted payment page when the manual gateway is active.
   * `PaymentsService.settleSandbox` 404s unless that gateway is configured, and
   * env validation forbids it in production.
   */
  @Get('sandbox/:cartId')
  @Redirect()
  async sandbox(@Param('cartId') cartId: string): Promise<{ url: string; statusCode: number }> {
    return { url: await this.payments.settleSandbox(cartId), statusCode: 302 };
  }
}
