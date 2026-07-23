import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LISTING_PAYMENT_PORT } from '../common/ports/listing-payment.port';
import { CreditsService } from './credits.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway.interface';
import { ManualGateway } from './gateway/manual.gateway';
import { PayTabsGateway } from './gateway/paytabs.gateway';

/**
 * Exports the payment port and nothing else. Other modules resolve
 * `LISTING_PAYMENT_PORT` and never see `PaymentsService`, the gateway, or the
 * credit ledger — the isolation the architecture doc requires of this module.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    CreditsService,
    ManualGateway,
    PayTabsGateway,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService, ManualGateway, PayTabsGateway],
      useFactory: (config: ConfigService, manual: ManualGateway, paytabs: PayTabsGateway) =>
        config.getOrThrow<string>('PAYMENT_GATEWAY') === 'paytabs' ? paytabs : manual,
    },
    { provide: LISTING_PAYMENT_PORT, useExisting: PaymentsService },
  ],
  exports: [LISTING_PAYMENT_PORT],
})
export class PaymentsModule {}
