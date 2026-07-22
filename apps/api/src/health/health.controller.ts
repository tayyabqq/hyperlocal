import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';

interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'ok' | 'unreachable';
}

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok', db: 'ok' };
    } catch {
      return { status: 'degraded', db: 'unreachable' };
    }
  }
}
