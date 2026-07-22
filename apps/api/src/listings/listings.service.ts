import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import {
  AnalyticsEvent,
  ErrorCode,
  ListingStatus,
  type BrowseListingsResult,
  type ListingSummary,
  type UserRole,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { listings, users } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { AnalyticsService } from '../analytics/analytics.service';
import { isWithinUae } from '../common/geo/uae-bounds';
import type { CreateListingDto } from './dto/create-listing.dto';

const LISTING_TTL_DAYS = 7;
const DEFAULT_RADIUS_METERS = 2000;
const MAX_RESULTS = 200;
const BROWSE_CACHE_TTL_SECONDS = 20;
// ~110m grid at the equator — coarse enough to make nearby requests share a
// cache entry, fine enough that "nearby" still means nearby.
const CACHE_GRID_PRECISION = 3;

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
  createdAt: Date;
  expiresAt: Date;
  distanceMeters: number | null;
}

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly analytics: AnalyticsService,
  ) {}

  async create(
    authorId: string,
    authorRole: UserRole,
    dto: CreateListingDto,
  ): Promise<ListingSummary> {
    if (!isWithinUae(dto.latitude, dto.longitude)) {
      throw new BadRequestException({
        errorCode: ErrorCode.LOCATION_OUT_OF_BOUNDS,
        message: 'Listings must be located within the UAE.',
      });
    }

    const expiresAt = new Date(Date.now() + LISTING_TTL_DAYS * 86_400_000);

    // Geography column is set via ST_MakePoint/ST_SetSRID — Drizzle's insert
    // builder can't express that, so this one write goes through raw SQL.
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO ${listings} (author_id, author_role, category, pay_amount_aed, description,
        latitude, longitude, location, location_label, expires_at)
      VALUES (${authorId}, ${authorRole}, ${dto.category}, ${dto.payAmountAed}, ${dto.description},
        ${dto.latitude}, ${dto.longitude},
        ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
        ${dto.locationLabel}, ${expiresAt})
      RETURNING id
    `);

    const insertedId = rows[0]?.id;
    if (!insertedId) {
      throw new Error('Listing insert did not return an id');
    }

    await this.invalidateBrowseCache();
    await this.analytics.track(AnalyticsEvent.LISTING_CREATED, authorId, {
      category: dto.category,
      payAmountAed: dto.payAmountAed,
    });

    return this.findById(insertedId, null);
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
        l.status, l.created_at AS "createdAt", l.expires_at AS "expiresAt",
        ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) AS "distanceMeters"
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

  async findById(id: string, viewerCoords: { latitude: number; longitude: number } | null): Promise<ListingSummary> {
    const distanceExpr = viewerCoords
      ? sql`ST_Distance(l.location, ST_SetSRID(ST_MakePoint(${viewerCoords.longitude}, ${viewerCoords.latitude}), 4326)::geography)`
      : sql`NULL`;

    const rows = await this.db.execute<ListingQueryRow>(sql`
      SELECT
        l.id, l.author_id AS "authorId", l.author_role AS "authorRole",
        u.display_name AS "authorDisplayName",
        l.category, l.pay_amount_aed AS "payAmountAed", l.description,
        l.latitude, l.longitude, l.location_label AS "locationLabel",
        l.status, l.created_at AS "createdAt", l.expires_at AS "expiresAt",
        ${distanceExpr} AS "distanceMeters"
      FROM ${listings} l
      JOIN ${users} u ON u.id = l.author_id
      WHERE l.id = ${id}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_FOUND,
        message: 'This listing no longer exists.',
      });
    }
    return this.rowToSummary(row);
  }

  /** Runs on a schedule (see ListingExpiryTask) rather than filtering status at read time only, so an expired listing's status is durably correct for anyone querying it directly. */
  async expireOverdueListings(): Promise<number> {
    const result = await this.db
      .update(listings)
      .set({ status: 'EXPIRED' })
      .where(and(eq(listings.status, 'ACTIVE'), gt(sql`now()`, listings.expiresAt)))
      .returning({ id: listings.id });

    if (result.length > 0) {
      await this.invalidateBrowseCache();
      this.logger.log(`Expired ${result.length} listing(s).`);
    }
    return result.length;
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
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
