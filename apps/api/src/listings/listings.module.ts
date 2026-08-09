import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StorageModule } from '../common/storage/storage.module';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingExpiryTask } from './listing-expiry.task';

/**
 * Imports PaymentsModule only to resolve `LISTING_PAYMENT_PORT`; the service
 * code depends on the port interface, never on anything inside payments.
 */
@Module({
  imports: [PaymentsModule, StorageModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingExpiryTask],
  exports: [ListingsService],
})
export class ListingsModule {}
