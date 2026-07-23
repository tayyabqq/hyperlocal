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
  PAYMENT_INITIATED: 'payment_initiated',
  PAYMENT_SETTLED: 'payment_settled',
  PAYMENT_FAILED: 'payment_failed',
  CREDIT_GRANTED: 'credit_granted',
  CREDIT_CONSUMED: 'credit_consumed',
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
