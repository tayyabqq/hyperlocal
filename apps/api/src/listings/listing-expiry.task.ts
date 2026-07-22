import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ListingsService } from './listings.service';

/**
 * The 7-day expiry the product spec requires. Runs every 5 minutes rather
 * than hourly: with a 7-day TTL, a listing sitting visibly expired for up to
 * an hour would be a visible bug on a map people check daily.
 */
@Injectable()
export class ListingExpiryTask {
  private readonly logger = new Logger(ListingExpiryTask.name);

  constructor(private readonly listings: ListingsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    try {
      await this.listings.expireOverdueListings();
    } catch (error) {
      this.logger.error('Listing expiry sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
