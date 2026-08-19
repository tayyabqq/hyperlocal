# syntax=docker/dockerfile:1

# Multi-stage build for the NestJS API. Built from the monorepo root so the
# workspace protocol (@hl/shared) resolves; see .dockerignore for what's excluded.

FROM node:20-slim AS base
ENV NODE_ENV=production
WORKDIR /app

# --- deps: install with dev deps so we can build ---
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Web/mobile manifests are needed for the workspace lockfile to resolve.
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
# @react-navigation/native declares react-native as a peer dependency; npm's
# strict peer resolution treats that as a conflict in this monorepo even
# though it only concerns apps/mobile, never apps/api. Same fix as .npmrc
# (not copied into this build context) and Vercel's Install Command override.
RUN npm ci --legacy-peer-deps

# --- build: compile shared + api to dist ---
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @hl/shared \
 && npm run build -w @hl/api

# --- prod deps only ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --omit=dev --legacy-peer-deps

# --- runtime ---
FROM base AS runtime
# bcrypt is a native module; the slim image already has the glibc it needs.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/package.json apps/api/

# Run as a non-root user.
RUN useradd --system --uid 1001 hl
USER hl

WORKDIR /app/apps/api
EXPOSE 3000
# Migrations are run as a separate ECS task (see docs/DEPLOYMENT.md), not at boot,
# so a rollout can't half-apply schema across multiple starting tasks.
CMD ["node", "dist/main.js"]
