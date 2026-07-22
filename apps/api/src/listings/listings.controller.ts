import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { BrowseListingsResult, ListingSummary } from '@hl/shared';
import { UserRole } from '@hl/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ListingsService } from './listings.service';
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
  ): Promise<ListingSummary> {
    return this.listings.create(user.id, user.role as UserRole, dto);
  }

  /** Public: browsing does not require an account, only posting does. */
  @Get()
  browse(@Query() query: BrowseListingsDto): Promise<BrowseListingsResult> {
    return this.listings.browse(query.latitude, query.longitude, query.radiusMeters);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<ListingSummary> {
    return this.listings.findById(id, null);
  }
}
