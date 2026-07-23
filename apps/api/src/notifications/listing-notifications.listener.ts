import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ListingEvent, type ListingExpiredEvent } from '../common/events/listing.events';
import { NotificationsService } from './notifications.service';

/**
 * Turns listing lifecycle events into pushes. Lives in the notifications module
 * so listings stays unaware of how — or whether — an expiry is surfaced to the
 * user. The re-post prompt is the retention playbook's most important automated
 * loop (P4/Execution Plan Phase 5).
 */
@Injectable()
export class ListingNotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(ListingEvent.EXPIRED)
  async onListingExpired(event: ListingExpiredEvent): Promise<void> {
    await this.notifications.notifyUser(event.authorId, {
      title: 'Your listing expired',
      body: `"${event.category}" has ended. Re-post in one tap to stay visible.`,
      data: { type: 'listing_expired', listingId: event.listingId },
    });
  }
}
