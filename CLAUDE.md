# CLAUDE.md

Guidance for working in this repository.

## What this is

Work Nearby — a hyperlocal, map-first, paid-intent work-discovery marketplace for
the UAE. Monorepo: `apps/api` (NestJS), `apps/web` (Next.js + admin), `apps/mobile`
(Expo/React Native), `packages/shared` (contracts), `infra/` (Terraform + k6).

The product scope is deliberately narrow — **post → see nearby → chat** with an
AED 10 fee. Before adding anything, check it against that core. The strategy docs
explicitly exclude ratings, AI matching, subscriptions, resume uploads, group
chat, and in-app worker payments from the MVP.

## Build & verify

Windows note: the machine's global npm cache points at a non-existent drive. Set
`npm_config_cache=C:\Users\<user>\AppData\Local\npm-cache` for npm commands, or
they fail with an ENOENT mkdir error.

```bash
npm run verify                 # shared build + api typecheck + lint + test
npm run typecheck -w @hl/web
npm run mobile:typecheck && npm run mobile:lint
```

Infra for local dev: `docker compose up -d` (Postgres+Redis). If 5432 is taken,
`POSTGRES_PORT=55432 docker compose up -d` and use that port in `DATABASE_URL`.
Dev JWT keys: `./scripts/gen-jwt-keys.sh ./keys-dev`.

## Conventions that matter

- **Vertical slices.** A feature is DB migration + API + web + mobile + tests
  together. Don't leave a layer half-done.
- **Module isolation.** Never import another feature module's internals. Use a
  typed port (`apps/api/src/common/ports`) or a domain event
  (`apps/api/src/common/events`). Payments and moderation are isolated this way;
  keep them that way. Listings talks to payments through `LISTING_PAYMENT_PORT`
  and learns of settlement via `PaymentEvent.SETTLED`. Chat screens messages
  through `MESSAGE_SCREEN_PORT`, provided globally by moderation.
- **One error shape.** Throw Nest exceptions with `{ errorCode, message }`;
  `errorCode` values live in `packages/shared` and clients branch on them.
- **Money is integer fils.** Never a float. Use `formatAed` for display.
- **Analytics are append-only.** Event names in `packages/shared` are stable once
  shipped — the five launch metrics are queries over `analytics_events`.
- **Env fails fast.** Add new config to `env.validation.ts` with the right
  optional/required rules and the production guardrails. Update `.env.example`.

## Database

Drizzle ORM. Schema in `apps/api/src/db/schema.ts`. To change it:

```bash
cd apps/api
npm run db:generate            # generates SQL + runs the PostGIS quoting fix
# review the generated migration by hand, then:
DATABASE_URL=... npm run db:migrate
```

Hand-check generated migrations for two things: the PostGIS `geography` type
(a post-generate script fixes drizzle's quoting), and enum changes — drizzle
wraps all pending migrations in one transaction, so `ALTER TYPE ... ADD VALUE`
is illegal; swap the enum type instead (see `0002`). Raw `db.execute` returns
timestamps as strings and cannot bind a `Date` parameter — coerce with
`.toISOString()`.

## Tests

Jest, service-level with mocked DB/Redis/ports (`apps/api/test`). The DB mock is a
thenable chain; match the shape of the query builder you're testing. When you add
a constructor dependency to a service, update its spec's providers.

## Gotchas learned the hard way

- `nest build` uses `tsconfig.build.json` (excludes tests) so output lands at
  `dist/main.js`, not `dist/src/main.js`.
- The manual payment gateway and console OTP/push providers are dev-only and are
  refused under `NODE_ENV=production` by env validation.
- Admin is out-of-band: `npm run make-admin -w @hl/api -- +9715...`.

## Docs

`docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`,
`docs/API.md`. Read `ARCHITECTURE.md` first.
