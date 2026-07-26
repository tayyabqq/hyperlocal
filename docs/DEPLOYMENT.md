# Deployment

Target: **AWS me-central-1 (UAE)**, ECS Fargate behind an ALB, RDS PostgreSQL +
PostGIS, ElastiCache Redis, secrets in Secrets Manager, logs and metrics in
CloudWatch, errors in Sentry. All resources stay in-region for data residency.

## One-time bootstrap

1. **State backend.** Create the S3 bucket `hyperlocal-tfstate` and DynamoDB lock
   table `hyperlocal-tflock` in `me-central-1` (referenced by
   `infra/terraform/versions.tf`).
2. **ACM certificate.** Request a certificate in `me-central-1` covering both
   `worknearby.ae` and `api.worknearby.ae` (SAN). Validate via DNS.
3. **Terraform.**
   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars   # fill in ARNs + domains + images
   terraform init
   terraform apply
   ```
   This provisions the VPC, RDS, Redis, ECR repos, ECS cluster/services, ALB, IAM
   roles, CloudWatch log groups, and the app secret.
4. **Route 53.** Point `worknearby.ae` and `api.worknearby.ae` at the ALB
   (`alb_dns_name` output).
5. **Seed non-derived secrets.** Terraform stores `DATABASE_URL` and `REDIS_URL`
   in the app secret and then ignores changes to it. Add the rest as JSON keys on
   the same secret (`app_secret_arn` output):
   `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `WHATSAPP_*`, `PAYTABS_PROFILE_ID`,
   `PAYTABS_SERVER_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`,
   `SENTRY_DSN`. Generate the JWT keypair with `scripts/gen-jwt-keys.sh` and paste
   the PEM contents.

## Continuous delivery

`.github/workflows/ci.yml`:

- On every PR/push: typecheck + lint + test the API against a real Postgres+Redis,
  build all three apps.
- On `main`: build and push the API and web images to ECR, tagged with the commit
  SHA. Requires repo secrets `AWS_DEPLOY_ROLE_ARN` (OIDC role),
  `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`.

Image builds are verified locally too — both Dockerfiles are multi-stage and the
API image runs as a non-root user.

## Releasing a new version

Deploy is deliberately **not** automatic after the image push, so a schema change
is never applied unattended.

1. **Migrate** (run once per release, before the service update). Migrations are a
   one-off ECS task, not run at container boot — that keeps multiple starting
   tasks from racing to apply schema:
   ```bash
   aws ecs run-task \
     --cluster hyperlocal-prod \
     --task-definition hyperlocal-prod-api \
     --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/db/migrate.js"]}]}' \
     --launch-type FARGATE --network-configuration '<private-subnets+ecs-sg>'
   ```
   The runner enables PostGIS (`CREATE EXTENSION IF NOT EXISTS postgis`) before
   applying migrations, so local, CI, and prod stay identical.
2. **Update services** to the new image (register a new task-def revision with the
   SHA tag, then `aws ecs update-service ... --force-new-deployment`), or
   `terraform apply` with the new `api_image` / `web_image`.
3. ECS does a rolling replacement; the ALB health checks (`/v1/health`, `/`) gate
   traffic to healthy tasks. Roll back by pointing the service at the previous SHA.

## Environment variables

The API validates its entire environment at boot and **fails fast** on anything
missing or inconsistent (`apps/api/src/config/env.validation.ts`). The production
guardrails refuse to start with dev-only providers:

- `OTP_PROVIDER=console` — rejected under `NODE_ENV=production`.
- `PAYMENT_GATEWAY=manual` — rejected under `NODE_ENV=production` (it settles
  orders without taking money).
- `PUSH_PROVIDER=console` — rejected under `NODE_ENV=production`.

See `apps/api/.env.example` for the full list with descriptions. Secrets come from
Secrets Manager and are injected into the task by the ECS `secrets` block, never
baked into an image.

## Observability

- **CloudWatch**: container logs via the `awslogs` driver; Container Insights for
  ECS/ALB metrics. Set alarms on ALB 5xx rate, target health, RDS CPU/connections,
  and Redis evictions.
- **Sentry**: application errors. Initialised only when `SENTRY_DSN` is set; the
  global exception filter reports 5xx (never 4xx).
- **Health**: `GET /v1/health` returns `{ status, db, redis }` and backs the ALB
  target health check. Returns **503** (not 200) when the database is
  unreachable, so the ALB actually pulls a broken instance out of rotation.
  Redis is a soft dependency — an unreachable Redis reports `status: "degraded"`
  in a 200 response, since browse falls back to the DB and chat degrades to
  single-node.

## Load testing

```bash
BASE_URL=https://api.worknearby.ae k6 run infra/load-test/browse.k6.js
```

Ramps to 500 concurrent against the geo-browse hot path and asserts the
Technology doc's budget (p95 < 1s, <1% errors). Run against a seeded staging
environment before a launch, per the execution plan ("tested with JMeter before
beta, not after launch").

## Mobile release

The Expo app is Android-first. For a production build you need a dev/EAS build
with FCM configured: add `google-services.json` (referenced in `app.json`), set
the FCM service account on the API secret, and build via EAS. The device push
token registered on login is the native FCM token.
