# Architecture

The technical strategy is the one stated in the Technology & Scalability
document: **boring technology, executed rigorously.** Mature components, a
modular monolith, no AI in the core, and UAE data residency from day one.

## System shape

```
              ┌──────────────┐        ┌──────────────┐
   Android ──▶│  Mobile app  │        │   Web app    │◀── Browser
   (Expo/RN)  └──────┬───────┘        │  (Next.js)   │
                     │                └──────┬───────┘
                     │  HTTPS + WSS          │  HTTPS + WSS
                     ▼                       ▼
                ┌─────────────────────────────────┐
                │        NestJS API (:3000)         │
                │  REST (/v1/*) + /chat WebSocket   │
                │                                   │
                │  Auth · Users · Listings ·        │
                │  Payments · Chat · Notifications ·│
                │  Moderation/Admin · Analytics     │
                └───────┬───────────────┬───────────┘
                        │               │
                 ┌──────▼─────┐   ┌─────▼──────┐
                 │ PostgreSQL │   │   Redis     │
                 │ + PostGIS  │   │ cache/fanout│
                 └────────────┘   └─────────────┘
```

All of it runs in **AWS me-central-1 (UAE)**. Nothing leaves the region.

## Why a modular monolith

Per the Technology doc, microservices multiply operational overhead a two-person
team can't absorb pre-PMF. A modular monolith gives the same modularity — modules
are cleanly separated internally — at a fraction of the operational cost, and each
module is extractable into a service later without a rewrite because the seams are
already there.

### The seams

Modules never import each other's internals. They communicate two ways:

1. **Ports** — a typed interface + DI token in `apps/api/src/common/ports`.
   - `LISTING_PAYMENT_PORT`: listings asks payments to charge, without importing
     payments. The payments module is the architecture doc's isolation
     requirement made literal — "no other module imports from it except via a
     service interface."
   - `MESSAGE_SCREEN_PORT`: chat screens a message, without importing moderation.
     The moderation module provides the real keyword-backed implementation
     globally; chat only knows the contract.

2. **Domain events** — published via `EventEmitter2`, contracts in
   `apps/api/src/common/events`.
   - `PaymentEvent.SETTLED` → listings activates the paid listing and starts its
     7-day clock. The return path is an event so the dependency graph stays
     acyclic and a fault in payments cannot propagate synchronously into the
     listing write path.
   - `ListingEvent.EXPIRED` → notifications sends the re-post push. Listings
     never imports notifications.

This is what keeps "one bug in payments should never take down listings or chat"
(Engineering Non-Negotiables) true by construction.

## Data model highlights

- **`listings`** carries both `latitude`/`longitude` (plain floats, for every
  non-geo read) and a PostGIS `geography(Point,4326)` column (`location`) with a
  GIST index. The radius query is `ST_DWithin(location, point, radius)`, which
  the index makes sub-linear. A listing is born `PENDING_PAYMENT` and is invisible
  to everyone but its author until payment settles.
- **`payment_orders`** has a partial unique index allowing at most one `PAID` row
  per listing, so a duplicated webhook can never charge or activate twice.
  Amounts are integer **fils** (AED minor units) — money is never a float.
- **`listing_credits`** is an append-only ledger; balance is the sum. The launch
  offer (first listing free) is a grant row.
- **`conversations`** are 1-to-1, unique per `(listing, inquirer)`, so "open chat"
  is idempotent. **`messages`** page by keyset on `(conversation, created_at, id)`.
- **`analytics_events`** is an append-only spine. The five launch metrics
  (time-to-first-chat, reply rate, repeat posting rate, local density, paid
  conversion) are queries over it, so instrumentation exists from the first user
  action rather than being reconstructed later.
- **Moderation**: `reports`, `moderation_actions` (append-only audit),
  `blocked_keywords` (seeded with scam patterns), and `users.is_admin` /
  `banned_at`.

## Security architecture

Mapped to the Technology doc's security table:

| Layer | Implementation |
| --- | --- |
| Transport | TLS 1.3 at the ALB (`ELBSecurityPolicy-TLS13-1-2-2021-06`) |
| Authentication | JWT RS256 (asymmetric); refresh tokens are SHA-256 hashed, rotated on use, reuse revokes all sessions |
| Authorization | Per-request role + ban read from the DB (not trusted from the token); `AdminGuard` for the admin surface |
| Rate limiting | `@nestjs/throttler` global + per-endpoint (Redis-backed at scale) |
| Geofencing | UAE-bounds check on listing creation |
| Payment security | PCI-out-of-scope: card data never touches the API; the gateway hosts the page; webhook HMAC-verified over the raw body |
| Secrets | AWS Secrets Manager in production; env-validated at boot, fails fast |
| Input validation | `class-validator` DTOs + a global `ValidationPipe` with `whitelist`/`forbidNonWhitelisted` |
| Moderation | Paid-fee primary filter + keyword blacklist + user reports + admin kill/ban, all audit-logged |

Banned accounts are blocked on their **next request** — the JWT strategy checks
`banned_at` every time — and their sessions are revoked and listings removed on
ban.

## Realtime & scale-out

Chat is socket.io at the `/chat` namespace, authenticated in the handshake with
the same RS256 access token as REST. Messages fan out to the two participants'
per-user rooms, so a user is reachable on any device without presence
bookkeeping. A `@socket.io/redis-adapter` fans events across API instances, so
the scalability roadmap's "chat module split; Redis cluster" step is an
infrastructure change, not a rewrite. It degrades to single-node if Redis is
unavailable at boot.

## Scalability roadmap (triggered by metrics, not forecasts)

| Users | Action | Trigger |
| --- | --- | --- |
| 0–1K | Single instance (2 tasks for HA) | initial |
| 1K–5K | Vertical scale RDS | API p95 > 1.5s |
| 5K–10K | RDS read replica + Redis geo cache | geo query > 300ms |
| 10K–50K | Chat split, Redis cluster | WS > 5K concurrent |
| 50K+ | Geo sharding per emirate | cross-emirate latency rising |

The code is already positioned for the first three: the browse cache, the GIST
index, and the Redis socket adapter are in place.

## Performance budget

- Map load < 2s on mid-range Android; API p95 < 1s; geo query < 200ms.
- Browse responses are Redis-cached on a ~110 m grid (20 s TTL), invalidated on
  any listing write/activation/expiry.
- The web app ships as static/SSR where possible; heavy client routes (map) are
  code-split. See `infra/load-test/browse.k6.js` for the 500-concurrent check
  against these targets.
