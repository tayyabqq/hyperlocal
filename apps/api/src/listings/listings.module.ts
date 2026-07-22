import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingExpiryTask } from './listing-expiry.task';

@Module({
  controllers: [ListingsController],
  providers: [ListingsService, ListingExpiryTask],
  exports: [ListingsService],
})
export class ListingsModule {}
