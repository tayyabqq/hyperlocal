import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type {
  BrowseListingsResult,
  CreateListingResult,
  ListingImage,
  ListingSummary,
  PaymentOrderSummary,
} from '@hl/shared';
import { ErrorCode, MAX_IMAGE_SIZE_BYTES, MAX_LISTING_IMAGES, UserRole } from '@hl/shared';
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

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post(':id/images')
  @UseInterceptors(
    FilesInterceptor('images', MAX_LISTING_IMAGES, {
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  uploadImages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<ListingImage[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'At least one image is required.',
      });
    }
    return this.listings.uploadImages(
      id,
      user.id,
      files.map((f) => ({ buffer: f.buffer, filename: f.originalname, mimetype: f.mimetype })),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/images/:imageId')
  deleteImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    return this.listings.deleteImage(id, imageId, user.id);
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
