import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ErrorCode } from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { REDIS } from '../redis/redis.module';

interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'ok' | 'unreachable';
  redis: 'ok' | 'unreachable';
}

/**
 * Backs the ALB target-group health check (`matcher = "200"` in
 * infra/terraform/alb.tf). The database is a hard dependency — every request
 * needs it — so an unreachable DB throws 503, which pulls the instance out of
 * rotation instead of silently serving broken traffic.
 *
 * Redis is not: browse falls back to the DB on a cache miss, and the chat
 * socket adapter degrades to single-node if Redis is unavailable. An
 * unreachable Redis is therefore reported as `degraded` but still returns 200
 * — the instance stays in rotation, and the body carries the signal for
 * monitoring/alerting to act on.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const dbOk = await this.db
      .execute(sql`SELECT 1`)
      .then(() => true)
      .catch(() => false);

    if (!dbOk) {
      // 503, not 200 with a "degraded" body: the ALB's health check only
      // understands status codes, and a DB-less instance must not receive
      // traffic. Uses the same { errorCode, message } shape as every other
      // failure so the global exception filter renders it consistently.
      throw new ServiceUnavailableException({
        errorCode: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Database unreachable.',
      });
    }

    const redisOk = await this.redis
      .ping()
      .then(() => true)
      .catch(() => false);

    return {
      status: redisOk ? 'ok' : 'degraded',
      db: 'ok',
      redis: redisOk ? 'ok' : 'unreachable',
    };
  }
}
