# Work Nearby — Hyperlocal Work Discovery Platform

A map-first, paid-intent marketplace that connects blue- and grey-collar workers
with employers within a ~2 km radius, in real time, in the UAE. The product does
one thing well: **post → see nearby → chat**, with a small payment as the entry
requirement. Everything outside that core is deliberately excluded.

This repository is the production implementation of the platform described in
the project's strategy documents (investor master, financial model, technology &
scalability, execution blueprint, strategic insights, and the founder execution
plan).

## What's here

An enterprise TypeScript monorepo:

| Path | What it is | Stack |
| --- | --- | --- |
| `apps/api` | Backend API + realtime gateway | NestJS (modular monolith), Drizzle ORM, PostgreSQL + PostGIS, Redis, socket.io |
| `apps/web` | Responsive website + admin panel | Next.js (App Router), Tailwind, Mapbox GL |
| `apps/mobile` | Android-first mobile app | React Native (Expo), Mapbox, expo-notifications |
| `packages/shared` | Cross-cutting contracts | Framework-agnostic TypeScript |
| `infra/terraform` | AWS me-central-1 infrastructure | Terraform (ECS Fargate, RDS, ElastiCache, ALB, Secrets Manager) |
| `infra/load-test` | Load test | k6 |

### Feature set (MVP scope, as specified)

- **Auth** — phone login via WhatsApp OTP (SMS-fallback shaped), RS256 JWT access
  tokens with rotating, reuse-detecting refresh tokens.
- **Listings** — map view, paid listing creation (AED 10), radius-bounded browse
  via PostGIS `ST_DWithin`, 7-day auto-expiry.
- **Payments** — PayTabs hosted payment, AED 10 fee wall, free-listing credits
  for launch seeding, webhook idempotency, PCI-out-of-scope by design. The
  payments module is fully isolated.
- **Chat** — realtime 1-to-1 messaging (WebSocket + REST fallback), scoped to a
  listing, with Redis fan-out for horizontal scale.
- **Notifications** — FCM push for new messages and the listing-expiry re-post
  prompt; device-token registration with dead-token pruning.
- **Moderation & admin** — keyword blacklist (pre-seeded scam patterns), user
  reporting, an admin panel (metrics, report queue, bans, kill switch, keyword
  management), audit logging, and a per-account weekly listing cap.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for shipping it.

## Run it locally

### Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)
- OpenSSL (for dev JWT keys)

### 1. Install and start infrastructure

```bash
npm install
docker compose up -d          # Postgres (PostGIS) + Redis
```

If port 5432 is taken by a local Postgres, override it:
`POSTGRES_PORT=55432 docker compose up -d` (then use that port in `DATABASE_URL`).

### 2. Generate dev JWT keys

```bash
./scripts/gen-jwt-keys.sh ./keys-dev
```

### 3. Configure and migrate the API

```bash
cp apps/api/.env.example apps/api/.env
# paste the two PEM files into JWT_PRIVATE_KEY / JWT_PUBLIC_KEY, set DATABASE_URL port
cd apps/api && npm run db:migrate && cd ../..
```

The dev defaults use the **console** OTP provider (logs the code), the **manual**
payment gateway (a sandbox settle endpoint), and the **console** push provider
(logs notifications). None of these boot under `NODE_ENV=production`.

### 4. Start the apps

```bash
npm run api:dev                       # API on :3000  (REST + /chat socket)
npm run dev -w @hl/web                # Web on :3001
npm run start -w @hl/mobile           # Expo (Android)
```

Web needs `apps/web/.env.local` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
and a `NEXT_PUBLIC_MAPBOX_TOKEN`. Mobile reads `expo.extra` in `apps/mobile/app.json`.

### 5. Grant yourself admin (after logging in once)

```bash
DATABASE_URL=postgresql://hl:hl@localhost:55432/hl npm run make-admin -w @hl/api -- +9715XXXXXXXX
```

Then open `/admin` in the web app.

## Verify

```bash
npm run verify          # shared build + api typecheck + lint + tests
npm run typecheck -w @hl/web
npm run mobile:typecheck
```

CI (`.github/workflows/ci.yml`) runs the same against a real Postgres+Redis, then
builds all three apps, and on `main` builds and pushes the Docker images.

## Repository conventions

- **Vertical slices.** A feature spans DB → API → web → mobile → tests, not a
  layer at a time.
- **Module isolation via ports.** Cross-module coupling goes through a typed port
  or a domain event (`common/ports`, `common/events`), never a direct import of
  another feature's internals. Payments and moderation are isolated this way.
- **One error shape.** Every API failure is `{ statusCode, errorCode, message,
  path, timestamp }`; clients branch on `errorCode` (see `packages/shared`).
- **Migrations are generated, then reviewed.** `npm run db:generate` in
  `apps/api`; the PostGIS geography type and enum swaps are hand-checked.

## License

Proprietary — internal project. Not for distribution.
