import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import {
  ALLOWED_IMAGE_MIMETYPES,
  AnalyticsEvent,
  ErrorCode,
  ListingStatus,
  MAX_LISTING_IMAGES,
  type BrowseListingsResult,
  type CreateListingResult,
  type ListingImage,
  type ListingSummary,
  type PaymentOrderSummary,
  type UserRole,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { listingImages, listings, users } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { ConfigService } from '@nestjs/config';
import { isWithinUae } from '../common/geo/uae-bounds';
import {
  LISTING_PAYMENT_PORT,
  type ListingCharge,
  type ListingPaymentPort,
} from '../common/ports/listing-payment.port';
import {
  PaymentEvent,
  type PaymentSettledEvent,
} from '../common/events/payment.events';
import { ListingEvent, type ListingExpiredEvent } from '../common/events/listing.events';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  type StoredFile,
} from '../common/storage/storage-provider.interface';
import type { CreateListingDto } from './dto/create-listing.dto';

/**
 * Reused by every read query (browse, mine, detail) to attach ordered images
 * in one round trip. Objects, not bare URLs — the dashboard's delete button
 * needs each image's id, not just where to render it.
 */
const IMAGES_SUBQUERY = sql`(
  SELECT COALESCE(
    json_agg(json_build_object('id', li.id, 'url', li.url, 'position', li.position) ORDER BY li.position),
    '[]'::json
  )
  FROM listing_images li WHERE li.listing_id = l.id
)`;

const LISTING_TTL_DAYS = 7;
const DEFAULT_RADIUS_METERS = 2000;
const MAX_RESULTS = 200;
const BROWSE_CACHE_TTL_SECONDS = 20;
const WEEK_MS = 7 * 86_400_000;
// Default cap on listings per account per rolling week. Stops labour agents
// from flooding the map and converting it into an agency board (P5: platform
// capture by power users). Overridable via WEEKLY_LISTING_LIMIT.
const DEFAULT_WEEKLY_LISTING_LIMIT = 20;
// ~110m grid at the equator — coarse enough to make nearby requests share a
// cache entry, fine enough that "nearby" still means nearby.
const CACHE_GRID_PRECISION = 3;
// How long an unpaid listing may sit before it is swept. Long enough that a
// user who abandons the payment page can still come back and finish it.
const ABANDONED_DRAFT_TTL_HOURS = 24;

/** Everything the payment gateway needs about the poster, without importing the auth types. */
export interface ListingAuthor {
  id: string;
  role: UserRole;
  displayName: string;
  phoneE164: string;
}

interface ListingQueryRow {
  [key: string]: unknown;
  id: string;
  authorId: string;
  authorRole: string;
  authorDisplayName: string;
  category: string;
  payAmountAed: number;
  description: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  status: string;
  // Raw `db.execute` returns timestamps as strings, not Date objects, so these
  // are coerced through `toIso` rather than dereferenced directly.
  createdAt: string | Date;
  activatedAt: string | Date | null;
  expiresAt: string | Date | null;
  distanceMeters: number | null;
  images: ListingImage[] | null;
}

/** Timestamps come back from raw SQL as strings; the query builder gives Dates. Handle both. */
function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  private readonly weeklyLimit: number;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(LISTING_PAYMENT_PORT) private readonly payments: ListingPaymentPort,
    private readonly analytics: AnalyticsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    this.weeklyLimit = Number(
      this.config.get<string>('WEEKLY_LISTING_LIMIT') ?? DEFAULT_WEEKLY_LISTING_LIMIT,
    );
  }

  /**
   * Creates the listing in PENDING_PAYMENT and opens a charge for it. The
   * listing is deliberately written before the charge so the order can
   * reference it, and it stays invisible to browse until payment settles — the
   * paid-intent gate the product is built around.
   */
  async create(author: ListingAuthor, dto: CreateListingDto): Promise<CreateListingResult> {
    if (!isWithinUae(dto.latitude, dto.longitude)) {
      throw new BadRequestException({
        errorCode: ErrorCode.LOCATION_OUT_OF_BOUNDS,
        message: 'Listings must be located within the UAE.',
      });
    }

    // Power-user guardrail: cap listings per rolling week so agents can't flood
    // the map. Counted before the write so the cap is never exceeded by one.
    if (this.weeklyLimit > 0) {
      const recent = await this.countRecentByAuthor(author.id, WEEK_MS);
      if (recent >= this.weeklyLimit) {
        throw new BadRequestException({
          errorCode: ErrorCode.WEEKLY_LISTING_LIMIT,
          message: `You can post up to ${this.weeklyLimit} listings per week. Try again in a few days.`,
        });
      }
    }

    // Geography column is set via ST_MakePoint/ST_SetSRID — Drizzle's insert
    // builder can't express that, so this one write goes through raw SQL.
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO ${listings} (author_id, author_role, category, pay_amount_aed, description,
        latitude, longitude, location, location_label, status)
      VALUES (${author.id}, ${author.role}, ${dto.category}, ${dto.payAmountAed}, ${dto.description},
        ${dto.latitude}, ${dto.longitude},
        ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
        ${dto.locationLabel}, 'PENDING_PAYMENT')
      RETURNING id
    `);

    const listingId = rows[0]?.id;
    if (!listingId) {
      throw new Error('Listing insert did not return an id');
    }

    await this.analytics.track(AnalyticsEvent.LISTING_CREATED, author.id, {
      category: dto.category,
      payAmountAed: dto.payAmountAed,
    });

    const charge = await this.chargeOrDiscard(listingId, author);

    return {
      // Re-read rather than reuse the pre-charge row: a credit settlement
      // activates the listing synchronously, and the client must see that.
      listing: await this.findById(listingId, null, author.id),
      order: toOrderSummary(charge, listingId),
    };
  }

  /** Re-opens payment for a listing the author started but never paid for. */
  async startPaymentRetry(listingId: string, author: ListingAuthor): Promise<PaymentOrderSummary> {
    const listing = await this.findById(listingId, null, author.id);

    if (listing.authorId !== author.id) {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_FOUND,
        message: 'This listing no longer exists.',
      });
    }
    if (listing.status !== ListingStatus.PENDING_PAYMENT) {
      throw new BadRequestException({
        errorCode: ErrorCode.PAYMENT_ALREADY_SETTLED,
        message: 'This listing has already been paid for.',
      });
    }

    const charge = await this.payments.chargeForListing({
      userId: author.id,
      listingId,
      displayName: author.displayName,
      phoneE164: author.phoneE164,
    });
    return toOrderSummary(charge, listingId);
  }

  /**
   * Author-only. Validates type and the per-listing cap before touching
   * storage — a rejected file should never reach S3/disk. Position continues
   * from the current count so repeated uploads append rather than collide.
   */
  async uploadImages(
    listingId: string,
    authorId: string,
    files: StoredFile[],
  ): Promise<ListingImage[]> {
    await this.requireOwnedListing(listingId, authorId, 'add photos to');

    for (const file of files) {
      if (!(ALLOWED_IMAGE_MIMETYPES as readonly string[]).includes(file.mimetype)) {
        throw new BadRequestException({
          errorCode: ErrorCode.INVALID_IMAGE_TYPE,
          message: 'Only JPEG, PNG, or WebP images are allowed.',
        });
      }
    }

    const existingCount = await this.countImages(listingId);
    if (existingCount + files.length > MAX_LISTING_IMAGES) {
      throw new BadRequestException({
        errorCode: ErrorCode.TOO_MANY_IMAGES,
        message: `A listing can have at most ${MAX_LISTING_IMAGES} photos (this one already has ${existingCount}).`,
      });
    }

    const uploaded: ListingImage[] = [];
    for (const [i, file] of files.entries()) {
      const { key, url } = await this.storage.upload(file);
      const [row] = await this.db
        .insert(listingImages)
        .values({ listingId, key, url, position: existingCount + i })
        .returning();
      uploaded.push({ id: row.id, url: row.url, position: row.position });
    }

    return uploaded;
  }

  /** Author-only. Deletes the storage object only after the row delete succeeds, so a crash never orphans a row pointing at nothing. */
  async deleteImage(listingId: string, imageId: string, authorId: string): Promise<void> {
    await this.requireOwnedListing(listingId, authorId, 'remove photos from');

    const [image] = await this.db
      .delete(listingImages)
      .where(and(eq(listingImages.id, imageId), eq(listingImages.listingId, listingId)))
      .returning();

    if (!image) {
      throw new NotFoundException({
        errorCode: ErrorCode.IMAGE_NOT_FOUND,
        message: 'That photo could not be found.',
      });
    }

    await this.storage.delete(image.key);
  }

  private async requireOwnedListing(
    listingId: string,
    authorId: string,
    action: string,
  ): Promise<{ authorId: string }> {
    const [listing] = await this.db
      .select({ authorId: listings.authorId, status: listings.status })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing || listing.status === 'REMOVED') {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_FOUND,
        message: 'This listing no longer exists.',
      });
    }
    if (listing.authorId !== authorId) {
      throw new ForbiddenException({
        errorCode: ErrorCode.FORBIDDEN,
        message: `You can only ${action} your own listings.`,
      });
    }
    return listing;
  }

  private async countImages(listingId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(listingImages)
      .where(eq(listingImages.listingId, listingId));
    return rows[0]?.count ?? 0;
  }

  async browse(
    latitude: number,
    longitude: number,
    radiusMeters: number = DEFAULT_RADIUS_METERS,
  ): Promise<BrowseListingsResult> {
    const cacheKey = this.browseCacheKey(latitude, longitude, radiusMeters);

    const cached = await this.redis.get(cacheKey).catch((error: unknown) => {
      this.logger.warn(`Redis read failed, falling back to DB: ${String(error)}`);
      return null;
    });
    if (cached) {
      return JSON.parse(cached) as BrowseListingsResult;
    }

    // ST_DWithin uses the GIST index to prune candidates before computing
    // exact distance — this is the query the geography column and its index
    // exist for.
    const rows = await this.db.execute<ListingQueryRow>(sql`
      SELECT
        l.id, l.author_id AS "authorId", l.author_role AS "authorRole",
        u.display_name AS "authorDisplayName",
        l.category, l.pay_amount_aed AS "payAmountAed", l.description,
        l.latitude, l.longitude, l.location_label AS "locationLabel",
        l.status, l.created_at AS "createdAt", l.activated_at AS "activatedAt",
        l.expires_at AS "expiresAt",
        ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) AS "distanceMeters",
        ${IMAGES_SUBQUERY} AS "images"
      FROM ${listings} l
      JOIN ${users} u ON u.id = l.author_id
      WHERE l.status = 'ACTIVE'
        AND l.expires_at > now()
        AND ST_DWithin(l.location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography, ${radiusMeters})
      ORDER BY "distanceMeters" ASC
      LIMIT ${MAX_RESULTS}
    `);

    const result: BrowseListingsResult = {
      listings: rows.map((r) => this.rowToSummary(r)),
      radiusMeters,
    };

    await this.redis
      .set(cacheKey, JSON.stringify(result), 'EX', BROWSE_CACHE_TTL_SECONDS)
      .catch((error: unknown) => this.logger.warn(`Redis write failed: ${String(error)}`));

    return result;
  }

  /** The author's own listings, including unpaid ones so they can finish paying. */
  async listMine(authorId: string): Promise<ListingSummary[]> {
    const rows = await this.db.execute<ListingQueryRow>(sql`
      SELECT
        l.id, l.author_id AS "authorId", l.author_role AS "authorRole",
        u.display_name AS "authorDisplayName",
        l.category, l.pay_amount_aed AS "payAmountAed", l.description,
        l.latitude, l.longitude, l.location_label AS "locationLabel",
        l.status, l.created_at AS "createdAt", l.activated_at AS "activatedAt",
        l.expires_at AS "expiresAt", NULL AS "distanceMeters",
        ${IMAGES_SUBQUERY} AS "images"
      FROM ${listings} l
      JOIN ${users} u ON u.id = l.author_id
      WHERE l.author_id = ${authorId} AND l.status <> 'REMOVED'
      ORDER BY l.created_at DESC
      LIMIT ${MAX_RESULTS}
    `);
    return rows.map((r) => this.rowToSummary(r));
  }

  async findById(
    id: string,
    viewerCoords: { latitude: number; longitude: number } | null,
    viewerId: string | null = null,
  ): Promise<ListingSummary> {
    const distanceExpr = viewerCoords
      ? sql`ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${viewerCoords.longitude}, ${viewerCoords.latitude}), 4326)::geography)`
      : sql`NULL`;

    const rows = await this.db.execute<ListingQueryRow>(sql`
      SELECT
        l.id, l.author_id AS "authorId", l.author_role AS "authorRole",
        u.display_name AS "authorDisplayName",
        l.category, l.pay_amount_aed AS "payAmountAed", l.description,
        l.latitude, l.longitude, l.location_label AS "locationLabel",
        l.status, l.created_at AS "createdAt", l.activated_at AS "activatedAt",
        l.expires_at AS "expiresAt",
        ${distanceExpr} AS "distanceMeters",
        ${IMAGES_SUBQUERY} AS "images"
      FROM ${listings} l
      JOIN ${users} u ON u.id = l.author_id
      WHERE l.id = ${id}
      LIMIT 1
    `);

    const row = rows[0];
    // An unpaid or removed listing is indistinguishable from a missing one to
    // anyone but its author: no listing becomes visible without being paid for.
    if (!row || (row.status !== 'ACTIVE' && row.authorId !== viewerId)) {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_FOUND,
        message: 'This listing no longer exists.',
      });
    }
    return this.rowToSummary(row);
  }

  /**
   * Payment settled — the listing goes live and its 7-day clock starts now.
   * Guarded so a duplicated event cannot extend an already-live listing.
   */
  @OnEvent(PaymentEvent.SETTLED)
  async onPaymentSettled(event: PaymentSettledEvent): Promise<void> {
    try {
      const activatedAt = new Date();
      const [activated] = await this.db
        .update(listings)
        .set({
          status: 'ACTIVE',
          activatedAt,
          expiresAt: new Date(activatedAt.getTime() + LISTING_TTL_DAYS * 86_400_000),
        })
        .where(and(eq(listings.id, event.listingId), eq(listings.status, 'PENDING_PAYMENT')))
        .returning({ id: listings.id, authorId: listings.authorId });

      if (!activated) return;

      await this.invalidateBrowseCache();
      await this.analytics.track(AnalyticsEvent.LISTING_ACTIVATED, activated.authorId, {
        listingId: activated.id,
        orderId: event.orderId,
      });
      this.logger.log(`Listing ${activated.id} activated by order ${event.orderId}.`);
    } catch (error) {
      // Payments has already taken the money; failing here must not throw back
      // into the payments module, so it is logged for operator follow-up.
      this.logger.error(
        `Failed to activate listing ${event.listingId} after payment ${event.orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Runs on a schedule (see ListingExpiryTask) rather than filtering status at read time only, so an expired listing's status is durably correct for anyone querying it directly. */
  async expireOverdueListings(): Promise<number> {
    const result = await this.db
      .update(listings)
      .set({ status: 'EXPIRED' })
      .where(and(eq(listings.status, 'ACTIVE'), gt(sql`now()`, listings.expiresAt)))
      .returning({ id: listings.id, authorId: listings.authorId, category: listings.category });

    if (result.length > 0) {
      await this.invalidateBrowseCache();
      this.logger.log(`Expired ${result.length} listing(s).`);
      // The re-post prompt from the retention playbook: notifications listens
      // for these and pushes "your listing expired, re-post in one tap".
      for (const row of result) {
        await this.analytics.track(AnalyticsEvent.LISTING_EXPIRED, row.authorId, {
          listingId: row.id,
        });
        this.events.emit(ListingEvent.EXPIRED, {
          listingId: row.id,
          authorId: row.authorId,
          category: row.category,
        } satisfies ListingExpiredEvent);
      }
    }
    return result.length;
  }

  /**
   * Moderator kill switch. Any non-removed listing can be taken down; the
   * browse cache is invalidated so it disappears from the map immediately.
   * Returns whether a listing was actually removed so the caller can 404.
   */
  async removeByModerator(listingId: string): Promise<boolean> {
    const removed = await this.db
      .update(listings)
      .set({ status: 'REMOVED' })
      .where(and(eq(listings.id, listingId), sql`${listings.status} <> 'REMOVED'`))
      .returning({ id: listings.id });

    if (removed.length > 0) await this.invalidateBrowseCache();
    return removed.length > 0;
  }

  /**
   * Removes every live or pending listing belonging to a user — used when the
   * account is banned, so a scammer's listings leave the map with them rather
   * than lingering after the ban.
   */
  async removeAllByAuthor(authorId: string): Promise<number> {
    const removed = await this.db
      .update(listings)
      .set({ status: 'REMOVED' })
      .where(
        and(eq(listings.authorId, authorId), sql`${listings.status} IN ('ACTIVE', 'PENDING_PAYMENT')`),
      )
      .returning({ id: listings.id });

    if (removed.length > 0) await this.invalidateBrowseCache();
    return removed.length;
  }

  /** Listings a user created in the trailing window — the power-user guardrail. */
  async countRecentByAuthor(authorId: string, sinceMs: number): Promise<number> {
    // postgres.js cannot bind a Date as a raw parameter, so the cutoff crosses
    // the wire as an ISO string and is cast back to timestamptz in SQL.
    const since = new Date(Date.now() - sinceMs).toISOString();
    const rows = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM ${listings}
      WHERE author_id = ${authorId} AND status <> 'REMOVED' AND created_at >= ${since}::timestamptz
    `);
    return rows[0]?.count ?? 0;
  }

  /** Clears drafts whose payment was never completed so they stop accumulating. */
  async sweepAbandonedDrafts(): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDONED_DRAFT_TTL_HOURS * 3_600_000);
    const result = await this.db
      .update(listings)
      .set({ status: 'REMOVED' })
      .where(and(eq(listings.status, 'PENDING_PAYMENT'), lt(listings.createdAt, cutoff)))
      .returning({ id: listings.id });

    if (result.length > 0) {
      this.logger.log(`Removed ${result.length} abandoned unpaid listing(s).`);
    }
    return result.length;
  }

  /**
   * A listing nobody can pay for is dead weight on the map's integrity, so a
   * charge that cannot even be opened takes the draft down with it rather than
   * leaving an orphan the user can neither see nor complete.
   */
  private async chargeOrDiscard(listingId: string, author: ListingAuthor): Promise<ListingCharge> {
    try {
      return await this.payments.chargeForListing({
        userId: author.id,
        listingId,
        displayName: author.displayName,
        phoneE164: author.phoneE164,
      });
    } catch (error) {
      await this.db
        .update(listings)
        .set({ status: 'REMOVED' })
        .where(and(eq(listings.id, listingId), eq(listings.status, 'PENDING_PAYMENT')));
      throw error;
    }
  }

  private async invalidateBrowseCache(): Promise<void> {
    // Coarse grid keys mean a citywide scan on every write would be
    // expensive; instead the cache TTL (20s) is the eviction mechanism and
    // this call only clears keys we can enumerate cheaply.
    const keys = await this.redis.keys('browse:*').catch(() => [] as string[]);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  private browseCacheKey(lat: number, lng: number, radius: number): string {
    return `browse:${lat.toFixed(CACHE_GRID_PRECISION)}:${lng.toFixed(CACHE_GRID_PRECISION)}:${radius}`;
  }

  private rowToSummary(row: ListingQueryRow): ListingSummary {
    return {
      id: row.id,
      authorId: row.authorId,
      authorRole: row.authorRole as UserRole,
      authorDisplayName: row.authorDisplayName,
      category: row.category,
      payAmountAed: row.payAmountAed,
      description: row.description,
      latitude: row.latitude,
      longitude: row.longitude,
      locationLabel: row.locationLabel,
      status: row.status as ListingStatus,
      distanceMeters: row.distanceMeters !== null ? Math.round(row.distanceMeters) : null,
      createdAt: toIso(row.createdAt) as string,
      activatedAt: toIso(row.activatedAt),
      expiresAt: toIso(row.expiresAt),
      images: row.images ?? [],
    };
  }
}

function toOrderSummary(charge: ListingCharge, listingId: string): PaymentOrderSummary {
  return {
    id: charge.orderId,
    listingId,
    status: charge.status,
    amountFils: charge.amountFils,
    method: charge.method,
    redirectUrl: charge.redirectUrl,
    createdAt: charge.createdAt.toISOString(),
    paidAt: charge.paidAt?.toISOString() ?? null,
  };
}
