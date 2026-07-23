# Operations Runbook

Practical procedures for running Work Nearby in production, and the failure modes
the strategy documents flag as most likely.

## On-call quick reference

| Symptom | First look | Likely cause |
| --- | --- | --- |
| API 5xx spike | Sentry + CloudWatch API logs | bad deploy, DB connection exhaustion |
| Map slow / empty | RDS CPU, `browse` cache hit rate | geo query degradation, Redis down |
| Payments not activating listings | `payment_orders` rows, gateway callback logs | webhook not reaching `/v1/payments/callback`, signature mismatch |
| No push delivered | `PUSH_PROVIDER`, FCM logs, `device_tokens` | FCM creds expired, tokens pruned |
| Chat not delivering | Redis health, socket connect errors | Redis adapter down (still single-node OK), token expiry |

## Common procedures

### Grant / revoke admin

```bash
DATABASE_URL=<prod-url> npm run make-admin -w @hl/api -- +9715XXXXXXXX          # grant
DATABASE_URL=<prod-url> npm run make-admin -w @hl/api -- +9715XXXXXXXX --revoke  # revoke
```

There is no self-serve path to admin — this is the only way to create the first
one.

### Take down a bad listing / ban a user

Prefer the admin panel (`/admin` → Reports or Users). It writes an audit row and,
on ban, revokes sessions and pulls the account's listings off the map. Only fall
back to SQL in an incident, and record why.

### Roll back a release

Point the ECS services at the previous image SHA and force a new deployment
(`aws ecs update-service --force-new-deployment` against the prior task-def
revision). Migrations are forward-only; a rollback that needs a schema revert is
a manual, reviewed migration — never edit an applied migration file.

## Failure modes from the strategy docs

These are the ways hyperlocal marketplaces actually die (Execution Plan §Reality
Check). The platform is instrumented to detect each early.

### The empty-map trap

Users open the app, see few listings, leave. **Detect:** low browse counts, short
session duration, "no listings near me" reviews. **Act:** stop acquisition, seed
manually from the Phase 0/1 database, don't run ads until 40+ active listings in
the area. The admin metrics dashboard shows `activeListings` and
`listingsLast7Days`.

### One-time transactions, no repeat

Revenue flat month-over-month. **Detect:** `paidConversionPct` and repeat posting
trending down. **Act:** interview employers who posted once and didn't return; the
answer is a supply, UX, or trust problem — diagnose before spending.

### Worker supply collapse

Workers registered then stopped checking. **Detect:** conversations/messages per
day falling, time-to-first-contact rising. **Act:** the listing-expiry push and a
weekly "new work near you" digest re-engage dormant users; the expiry event is
already wired.

### Trust collapse from a bad listing

A scam listing spreads warnings through WhatsApp groups within hours. **Detect:** a
spike in reports on one target, a specific negative review. **Act:** respond within
2 hours — the admin queue surfaces the report with its target preview; kill the
listing and ban the author (both audit-logged); refund any payment manually; be
transparent with the affected users. Tighten the keyword blacklist if a new
pattern appears (Admin → Keywords).

### Platform capture by power users

Labour agents bulk-post and convert the map into an agency board. **Detect:** one
account posting far more than others. **Mitigation is already enforced:** the
per-account weekly listing cap (`WEEKLY_LISTING_LIMIT`, default 20). Lower it, or
set escalating pricing, before agents arrive — not after.

## Data & privacy

- All data resides in `me-central-1`. Do not create cross-region replicas or move
  backups out of region.
- Card data never touches the system (PayTabs hosts the payment page). The API
  stores only order metadata and the gateway's transaction reference.
- OTP codes are bcrypt-hashed and single-use; refresh tokens are SHA-256 hashed
  and rotated. Never log a raw token, OTP, or secret.

## Backups & recovery

- RDS: automated backups, 7-day retention, Multi-AZ. A final snapshot is taken on
  destroy (`deletion_protection = true`).
- To restore: create a new instance from the snapshot, update `DATABASE_URL` in
  the app secret, and force a new API deployment.
