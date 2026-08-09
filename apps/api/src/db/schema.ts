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
    /** Admin surface access. Granted out-of-band (see scripts/set-admin.ts). */
    isAdmin: boolean('is_admin').notNull().default(false),
    /** Set when a moderator bans the account; the JWT strategy blocks banned users on every request. */
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    bannedReason: text('banned_reason'),
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

export const listingStatus = pgEnum('listing_status', [
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'REMOVED',
]);

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
    status: listingStatus('status').notNull().default('PENDING_PAYMENT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The 7-day clock starts when the listing goes live, not when it is
     * created — an author who takes ten minutes on the payment page should not
     * lose ten minutes of visibility.
     */
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    statusExpiryIdx: index('listings_status_expiry_idx').on(t.status, t.expiresAt),
    authorIdx: index('listings_author_idx').on(t.authorId),
    // GIST is what makes ST_DWithin sub-linear instead of a full scan.
    geoIdx: index('listings_location_gist_idx').using('gist', t.location),
  }),
);

export type ListingRow = typeof listings.$inferSelect;

export const listingImages = pgTable(
  'listing_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    /** Storage-provider key (S3 object key, or filename under the local dev dir) — needed to delete the file, not just the row. */
    key: text('key').notNull(),
    url: text('url').notNull(),
    /** Display order within the listing, lowest first. */
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listingIdx: index('listing_images_listing_idx').on(t.listingId, t.position),
  }),
);

export type ListingImageRow = typeof listingImages.$inferSelect;

export const paymentOrderStatus = pgEnum('payment_order_status', ['PENDING', 'PAID', 'FAILED']);
export const paymentMethod = pgEnum('payment_method', ['CARD', 'CREDIT']);

/**
 * One row per attempt to pay for a listing. A listing may accumulate several
 * (abandoned page, declined card) but the partial unique index below allows at
 * most one PAID order per listing, so a duplicated webhook can never charge or
 * activate twice.
 *
 * No card data is stored or ever transits this service — the gateway hosts the
 * payment page, which is what keeps the platform out of PCI scope.
 */
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** AED minor units. Integer, because money must never be a float. */
    amountFils: integer('amount_fils').notNull(),
    currency: text('currency').notNull().default('AED'),
    status: paymentOrderStatus('status').notNull().default('PENDING'),
    method: paymentMethod('method').notNull(),
    provider: text('provider').notNull(),
    /** Our idempotency key, sent to the gateway and echoed back on the webhook. */
    providerCartId: text('provider_cart_id').notNull(),
    /** The gateway's own transaction reference, known only after it responds. */
    providerRef: text('provider_ref'),
    redirectUrl: text('redirect_url'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => ({
    cartIdx: uniqueIndex('payment_orders_cart_idx').on(t.providerCartId),
    listingIdx: index('payment_orders_listing_idx').on(t.listingId),
    userIdx: index('payment_orders_user_idx').on(t.userId),
    onePaidPerListing: uniqueIndex('payment_orders_one_paid_per_listing_idx')
      .on(t.listingId)
      .where(sql`status = 'PAID'`),
  }),
);

/**
 * Append-only credit ledger: +1 when a credit is granted (launch seeding gives
 * every early user their first listing free), −1 when one is spent. Balance is
 * the sum. Append-only rather than a counter column so every free listing is
 * traceable to the grant that funded it.
 */
export const listingCredits = pgTable(
  'listing_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('listing_credits_user_idx').on(t.userId, t.createdAt) }),
);

/**
 * Gateway callbacks are retried on any non-2xx, so the same event arrives more
 * than once. The unique key makes replay a no-op instead of a double credit.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identityIdx: uniqueIndex('webhook_events_identity_idx').on(t.provider, t.providerEventId),
  }),
);

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type ListingCreditRow = typeof listingCredits.$inferSelect;

/**
 * A 1-to-1 chat scoped to a listing, between the listing's author and one
 * inquirer. Group chat is deliberately excluded (P1), so the shape is fixed at
 * exactly two participants. `authorId` is denormalised from the listing so the
 * conversation and its access checks survive the listing being removed.
 *
 * The unique index makes "open chat" idempotent: a second tap on the same
 * listing reuses the existing thread rather than forking a parallel one.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inquirerId: uuid('inquirer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => ({
    pairIdx: uniqueIndex('conversations_listing_inquirer_idx').on(t.listingId, t.inquirerId),
    authorIdx: index('conversations_author_idx').on(t.authorId, t.lastMessageAt),
    inquirerIdx: index('conversations_inquirer_idx').on(t.inquirerId, t.lastMessageAt),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => ({
    // Keyset pagination reads newest-first within a conversation; the id tie-breaks
    // messages that share a timestamp.
    threadIdx: index('messages_thread_idx').on(t.conversationId, t.createdAt, t.id),
  }),
);

/**
 * Push targets. One row per (user, device). Android is the launch platform
 * (P1), so tokens are FCM registration tokens; the platform column keeps the
 * table honest if iOS/web are added later.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('device_tokens_token_idx').on(t.token),
    userIdx: index('device_tokens_user_idx').on(t.userId),
  }),
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type DeviceTokenRow = typeof deviceTokens.$inferSelect;

export const reportTargetType = pgEnum('report_target_type', ['LISTING', 'USER', 'MESSAGE']);
export const reportStatus = pgEnum('report_status', ['OPEN', 'RESOLVED', 'DISMISSED']);

/**
 * User reports — the trust backstop behind the paid-listing filter. A tight-knit
 * community warns each other fast (P5), so a report must reach a moderator
 * quickly; the status index keeps the open queue cheap to read.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reportTargetType('target_type').notNull(),
    /** Not a FK: targets span three tables, and a report should outlive its target. */
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    status: reportStatus('status').notNull().default('OPEN'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('reports_status_idx').on(t.status, t.createdAt),
    targetIdx: index('reports_target_idx').on(t.targetType, t.targetId),
  }),
);

/**
 * Append-only audit trail of every moderator action. Moderation cannot be
 * bolted on after launch (Engineering Non-Negotiables), and neither can its
 * accountability — every kill and ban is attributable.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable so an audit row survives the admin account being deleted; the
    // action itself is the record, the actor id is best-effort attribution.
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ adminIdx: index('moderation_actions_admin_idx').on(t.adminId, t.createdAt) }),
);

/**
 * Keyword blacklist, seeded with known scam patterns (Engineering
 * Non-Negotiables: "pre-populate with known scam patterns"). Editable by admins
 * and cached in memory by the message screen.
 */
export const blockedKeywords = pgTable(
  'blocked_keywords',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    term: text('term').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ termIdx: uniqueIndex('blocked_keywords_term_idx').on(t.term) }),
);

export type ReportRow = typeof reports.$inferSelect;
export type BlockedKeywordRow = typeof blockedKeywords.$inferSelect;
