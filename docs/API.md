# API Reference

Base path: `/v1`. All responses are JSON. Errors share one shape:

```json
{ "statusCode": 400, "errorCode": "OTP_INVALID", "message": "…", "path": "/v1/…", "timestamp": "…" }
```

Clients branch on `errorCode` (enumerated in `packages/shared`). Authenticated
endpoints take `Authorization: Bearer <accessToken>`. Access tokens live 15
minutes; refresh via the refresh token (rotating, reuse-detecting).

## Auth

| Method | Path | Auth | Body / notes |
| --- | --- | --- | --- |
| POST | `/auth/otp/request` | — | `{ phoneE164 }` → `{ challengeId, retryAfterSeconds, expiresInSeconds }` |
| POST | `/auth/otp/verify` | — | `{ challengeId, phoneE164, code }` → `{ tokens, user, isNewUser }` |
| POST | `/auth/refresh` | — | `{ refreshToken }` → new `AuthTokens` |
| POST | `/auth/logout` | Bearer | revokes all sessions |

## Users

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/users/me` | Bearer | current `UserProfile` (includes `isAdmin`) |
| PATCH | `/users/me` | Bearer | `{ displayName, role }` — completes profile |

## Listings

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/listings` | Bearer | `CreateListingRequest` → `{ listing, order }`. Listing is `PENDING_PAYMENT` until the order is `PAID`. |
| GET | `/listings` | — | `?latitude&longitude&radiusMeters` → nearby `ACTIVE` listings (public) |
| GET | `/listings/mine` | Bearer | caller's listings incl. unpaid drafts |
| GET | `/listings/:id` | — | one listing (unpaid/removed visible only to author) |
| POST | `/listings/:id/pay` | Bearer | resumes payment for an abandoned draft → `PaymentOrderSummary` |

## Payments

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/payments/callback` | signature | gateway webhook; HMAC over the raw body; idempotent |
| GET | `/payments/orders/:id` | Bearer | poll an order's status |
| GET | `/payments/listings/:listingId/order` | Bearer | latest order for a listing |
| GET | `/payments/credits` | Bearer | `{ credits }` free-listing balance |
| GET | `/payments/sandbox/:cartId` | — | dev-only settle (manual gateway; 404 otherwise) |

## Chat

REST for setup/history; realtime over the `/chat` socket namespace.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/chat/conversations` | Bearer | `{ listingId }` → conversation (idempotent; author can't self-chat) |
| GET | `/chat/conversations` | Bearer | list with unread counts + previews |
| GET | `/chat/conversations/:id/messages` | Bearer | `?before=<ISO>` keyset page |
| POST | `/chat/conversations/:id/messages` | Bearer | `{ body }` — REST send fallback |
| POST | `/chat/conversations/:id/read` | Bearer | mark counterpart's messages read |

**Socket** (`/chat`, token in `auth: { token }`): emit `message:send`
`{ conversationId, body }`, `message:read` `{ conversationId }`; receive
`message:new` (a `ChatMessage`), `message:read`, `chat:error`.

## Notifications

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/notifications/devices` | Bearer | `{ token, platform }` register FCM token |
| DELETE | `/notifications/devices` | Bearer | `{ token, platform }` unregister |

## Reports (any authenticated user)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/reports` | Bearer | `{ targetType, targetId, reason }` (LISTING/USER/MESSAGE); dedups open reports |

## Admin (requires `isAdmin`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/metrics` | ops dashboard figures |
| GET | `/admin/reports` | `?status=OPEN` moderation queue with target previews |
| POST | `/admin/reports/:id/resolve` | `{ action, note }` — DISMISS / KILL_LISTING / BAN_USER |
| POST | `/admin/listings/:id/remove` | kill a listing |
| GET | `/admin/users` | `?search=` name/phone |
| GET | `/admin/users/:id` | one account |
| POST | `/admin/users/:id/ban` / `…/unban` | `{ note }` |
| GET / POST | `/admin/keywords` | list / add `{ term }` |
| DELETE | `/admin/keywords/:id` | remove a term |

Every mutating admin action writes a `moderation_actions` audit row.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ status, db }` — backs the ALB health check |
