/**
 * Contracts shared by api, web, and mobile. Runtime-agnostic: no framework
 * imports so every client can consume this package directly.
 */

export enum UserRole {
  SEEKER = 'SEEKER',
  PROVIDER = 'PROVIDER',
}

export interface UserProfile {
  id: string;
  phoneE164: string;
  displayName: string;
  role: UserRole;
  isProfileComplete: boolean;
  /** Grants access to the admin surface. Read from the DB on every request. */
  isAdmin: boolean;
  createdAt: string;
}

export interface RequestOtpBody {
  phoneE164: string;
}

export interface RequestOtpResult {
  challengeId: string;
  /** Seconds the client must wait before requesting another code. */
  retryAfterSeconds: number;
  /** Seconds until the issued code stops being accepted. */
  expiresInSeconds: number;
}

export interface VerifyOtpBody {
  challengeId: string;
  phoneE164: string;
  code: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface VerifyOtpResult {
  tokens: AuthTokens;
  user: UserProfile;
  isNewUser: boolean;
}

export interface RefreshBody {
  refreshToken: string;
}

export interface CompleteProfileBody {
  displayName: string;
  role: UserRole;
}

export interface ApiErrorBody {
  statusCode: number;
  errorCode: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/** Error codes the clients branch on. Keep in sync with the API. */
export const ErrorCode = {
  OTP_COOLDOWN: 'OTP_COOLDOWN',
  OTP_INVALID: 'OTP_INVALID',
  OTP_DELIVERY_FAILED: 'OTP_DELIVERY_FAILED',
  REFRESH_INVALID: 'REFRESH_INVALID',
  REFRESH_EXPIRED: 'REFRESH_EXPIRED',
  REFRESH_REUSE_DETECTED: 'REFRESH_REUSE_DETECTED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  LOCATION_OUT_OF_BOUNDS: 'LOCATION_OUT_OF_BOUNDS',
  LISTING_NOT_FOUND: 'LISTING_NOT_FOUND',
  PAYMENT_ORDER_NOT_FOUND: 'PAYMENT_ORDER_NOT_FOUND',
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
  PAYMENT_ALREADY_SETTLED: 'PAYMENT_ALREADY_SETTLED',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CONVERSATION_WITH_SELF: 'CONVERSATION_WITH_SELF',
  LISTING_NOT_ACTIVE: 'LISTING_NOT_ACTIVE',
  MESSAGE_REJECTED: 'MESSAGE_REJECTED',
  WEEKLY_LISTING_LIMIT: 'WEEKLY_LISTING_LIMIT',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TOO_MANY_IMAGES: 'TOO_MANY_IMAGES',
  INVALID_IMAGE_TYPE: 'INVALID_IMAGE_TYPE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  IMAGE_NOT_FOUND: 'IMAGE_NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Analytics events. The five metrics in the execution plan (time-to-first-chat,
 * reply rate, repeat posting rate, local density, paid conversion) are all
 * derived from these, so the names are append-only once shipped.
 */
export const AnalyticsEvent = {
  OTP_REQUESTED: 'otp_requested',
  OTP_VERIFIED: 'otp_verified',
  USER_REGISTERED: 'user_registered',
  PROFILE_COMPLETED: 'profile_completed',
  SESSION_REFRESHED: 'session_refreshed',
  LOGGED_OUT: 'logged_out',
  LISTING_CREATED: 'listing_created',
  LISTING_VIEWED: 'listing_viewed',
  LISTINGS_BROWSED: 'listings_browsed',
  LISTING_ACTIVATED: 'listing_activated',
  LISTING_EXPIRED: 'listing_expired',
  PAYMENT_INITIATED: 'payment_initiated',
  PAYMENT_SETTLED: 'payment_settled',
  PAYMENT_FAILED: 'payment_failed',
  CREDIT_GRANTED: 'credit_granted',
  CREDIT_CONSUMED: 'credit_consumed',
  CONVERSATION_STARTED: 'conversation_started',
  MESSAGE_SENT: 'message_sent',
  PUSH_SENT: 'push_sent',
  REPORT_CREATED: 'report_created',
  MESSAGE_BLOCKED: 'message_blocked',
  LISTING_MODERATED: 'listing_moderated',
  USER_BANNED: 'user_banned',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export enum ListingStatus {
  /** Created but unpaid: invisible to everyone except its author. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REMOVED = 'REMOVED',
}

export interface ListingSummary {
  id: string;
  authorId: string;
  authorRole: UserRole;
  authorDisplayName: string;
  category: string;
  payAmountAed: number;
  description: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  status: ListingStatus;
  /** Populated only when the request included the caller's coordinates. */
  distanceMeters: number | null;
  createdAt: string;
  /** Null until the listing is paid for and goes live. */
  activatedAt: string | null;
  /** Null until activation — the 7-day clock starts when the listing goes live. */
  expiresAt: string | null;
  /** Ordered, lowest position first. Empty for a listing with no photos yet. */
  images: ListingImage[];
}

/** Limits enforced server-side (Multer config + the images endpoint), not just in the UI. */
export const MAX_LISTING_IMAGES = 6;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface ListingImage {
  id: string;
  url: string;
  position: number;
}

export interface CreateListingRequest {
  category: string;
  payAmountAed: number;
  description: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
}

export interface BrowseListingsQuery {
  latitude: number;
  longitude: number;
  /** Defaults to 2000 (the product's documented default radius). */
  radiusMeters?: number;
}

export interface BrowseListingsResult {
  listings: ListingSummary[];
  radiusMeters: number;
}

/**
 * Payments. Amounts cross the wire in fils (AED minor units) so no client ever
 * has to reason about float rounding on money; `formatAed` is the only place
 * the conversion happens.
 */
export const FILS_PER_AED = 100;
export const LISTING_FEE_FILS = 10 * FILS_PER_AED;

export function formatAed(fils: number): string {
  return `AED ${(fils / FILS_PER_AED).toFixed(2)}`;
}

export enum PaymentOrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
}

export enum PaymentMethod {
  /** Hosted card payment through the gateway. */
  CARD = 'CARD',
  /** Settled from the user's free-listing credit balance; no money moves. */
  CREDIT = 'CREDIT',
}

export interface PaymentOrderSummary {
  id: string;
  listingId: string;
  status: PaymentOrderStatus;
  amountFils: number;
  method: PaymentMethod;
  /** Gateway-hosted page. Null for credit settlements and once already paid. */
  redirectUrl: string | null;
  createdAt: string;
  paidAt: string | null;
}

/**
 * What `POST /listings` returns. The listing is always created, but stays
 * invisible until its order reaches PAID — so clients must branch on the order,
 * not on the listing.
 */
export interface CreateListingResult {
  listing: ListingSummary;
  order: PaymentOrderSummary;
}

export interface CreditBalance {
  /** Free listings the user can post without paying. */
  credits: number;
}

/**
 * Chat. Strictly 1-to-1 and scoped to a listing (P1 excludes group chat by
 * design). A conversation is between the listing's author and one inquirer.
 */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationSummary {
  id: string;
  listingId: string;
  listingCategory: string;
  /** The other participant, from the caller's perspective. */
  counterpartId: string;
  counterpartName: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface StartConversationBody {
  listingId: string;
}

export interface SendMessageBody {
  body: string;
}

export interface ConversationMessagesResult {
  messages: ChatMessage[];
  /** Pass as `before` to page further back; null when the start is reached. */
  nextCursor: string | null;
}

/** Realtime channel names shared by the gateway and its clients. */
export const ChatSocketEvent = {
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_READ: 'message:read',
  ERROR: 'chat:error',
} as const;

export const MESSAGE_MAX_LENGTH = 1000;

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  WEB = 'WEB',
}

export interface RegisterDeviceBody {
  token: string;
  platform: DevicePlatform;
}

/** Moderation. The paid fee is the primary spam filter; these are the backstops. */
export enum ReportTargetType {
  LISTING = 'LISTING',
  USER = 'USER',
  MESSAGE = 'MESSAGE',
}

export enum ReportStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export interface CreateReportBody {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}

export const REPORT_REASON_MAX_LENGTH = 500;

export interface ReportSummary {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  reporterId: string;
  reporterName: string;
  /** Context for the queue: the reported listing/message text, when resolvable. */
  targetPreview: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** What an admin does when clearing a report. */
export enum ModerationAction {
  DISMISS = 'DISMISS',
  KILL_LISTING = 'KILL_LISTING',
  BAN_USER = 'BAN_USER',
}

export interface ResolveReportBody {
  action: ModerationAction;
  note?: string;
}

export interface AdminMetrics {
  totalUsers: number;
  bannedUsers: number;
  activeListings: number;
  listingsLast7Days: number;
  paidListingsLast7Days: number;
  /** Paid-order conversion over listings created in the window, as a percentage. */
  paidConversionPct: number;
  conversationsLast7Days: number;
  messagesLast7Days: number;
  openReports: number;
}

export interface BlockedKeyword {
  id: string;
  term: string;
  createdAt: string;
}

export interface AdminUserSummary {
  id: string;
  phoneE164: string;
  displayName: string;
  role: UserRole;
  isAdmin: boolean;
  bannedAt: string | null;
  bannedReason: string | null;
  createdAt: string;
}
