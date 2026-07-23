import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  BrowseListingsResult,
  CreateListingResult,
  ListingSummary,
  PaymentOrderSummary,
} from '@hl/shared';
import { UserRole } from '@hl/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ListingsService, type ListingAuthor } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';

@Controller({ path: 'listings', version: '1' })
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } }) // posting-abuse guardrail, tightened further in M5
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<CreateListingResult> {
    return this.listings.create(toAuthor(user), dto);
  }

  /** Public: browsing does not require an account, only posting does. */
  @Get()
  browse(@Query() query: BrowseListingsDto): Promise<BrowseListingsResult> {
    return this.listings.browse(query.latitude, query.longitude, query.radiusMeters);
  }

  /** Declared before `:id` so the literal path is not captured as an id. */
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser): Promise<ListingSummary[]> {
    return this.listings.listMine(user.id);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ListingSummary> {
    return this.listings.findById(id, null);
  }

  /** Resumes payment for a draft whose hosted page was abandoned. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post(':id/pay')
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentOrderSummary> {
    return this.listings.startPaymentRetry(id, toAuthor(user));
  }
}

function toAuthor(user: AuthenticatedUser): ListingAuthor {
  return {
    id: user.id,
    role: user.role as UserRole,
    displayName: user.displayName,
    phoneE164: user.phoneE164,
  };
}
