import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['SEEKER', 'PROVIDER']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    displayName: text('display_name').notNull().default(''),
    role: userRole('role').notNull().default('SEEKER'),
    /**
     * False until the user picks a name + role. Auth succeeds before this is
     * true, so clients route new users into onboarding rather than the map.
     */
    isProfileComplete: boolean('is_profile_complete').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ phoneIdx: uniqueIndex('users_phone_idx').on(t.phoneE164) }),
);

/** OTP codes are stored bcrypt-hashed, single-use, attempt-capped. */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ lookupIdx: index('otp_phone_created_idx').on(t.phoneE164, t.createdAt) }),
);

/**
 * Refresh tokens are stored as SHA-256 hashes and rotated on every use.
 * Presenting an already-rotated token is treated as theft: every session for
 * that user is revoked.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: uniqueIndex('refresh_token_hash_idx').on(t.tokenHash),
    userIdx: index('refresh_user_idx').on(t.userId),
  }),
);

/**
 * Append-only event spine. The five launch metrics are queries over this table,
 * so instrumentation exists from the first user action rather than being
 * reconstructed later.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventName: text('event_name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    properties: jsonb('properties').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameTimeIdx: index('analytics_name_time_idx').on(t.eventName, t.occurredAt),
    userIdx: index('analytics_user_idx').on(t.userId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export const listingStatus = pgEnum('listing_status', ['ACTIVE', 'EXPIRED', 'REMOVED']);

/**
 * PostGIS geography(Point,4326), driven with raw SQL at the call sites
 * (insert and the ST_DWithin query) because Drizzle has no native geography
 * type. `latitude`/`longitude` are kept as plain floats alongside it — not
 * duplication for its own sake: they let every non-geo read (list, detail,
 * "my listings") skip ST_X/ST_Y extraction entirely, while `location` alone
 * carries the GIST index that makes the radius query fast.
 */
const geographyPoint = customType<{ data: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authorRole: userRole('author_role').notNull(),
    category: text('category').notNull(),
    payAmountAed: integer('pay_amount_aed').notNull(),
    description: text('description').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    location: geographyPoint('location').notNull(),
    locationLabel: text('location_label').notNull(),
    status: listingStatus('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    statusExpiryIdx: index('listings_status_expiry_idx').on(t.status, t.expiresAt),
    authorIdx: index('listings_author_idx').on(t.authorId),
    // GIST is what makes ST_DWithin sub-linear instead of a full scan.
    geoIdx: index('listings_location_gist_idx').using('gist', t.location),
  }),
);

export type ListingRow = typeof listings.$inferSelect;
