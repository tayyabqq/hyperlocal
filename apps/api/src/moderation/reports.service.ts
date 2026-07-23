import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  ReportStatus,
  ReportTargetType,
  type ReportSummary,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { reports } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';

interface ReportQueryRow {
  [key: string]: unknown;
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  reporterId: string;
  reporterName: string;
  targetPreview: string | null;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly analytics: AnalyticsService,
  ) {}

  async create(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
    reason: string,
  ): Promise<{ id: string }> {
    // Collapse repeat reports of the same target by the same person into one
    // open row, so a frustrated user tapping twice doesn't spam the queue.
    const existing = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, reporterId),
          eq(reports.targetType, targetType),
          eq(reports.targetId, targetId),
          eq(reports.status, 'OPEN'),
        ),
      )
      .limit(1);

    if (existing[0]) return { id: existing[0].id };

    const [row] = await this.db
      .insert(reports)
      .values({ reporterId, targetType, targetId, reason: reason.trim() })
      .returning({ id: reports.id });

    await this.analytics.track(AnalyticsEvent.REPORT_CREATED, reporterId, {
      targetType,
      targetId,
    });
    return { id: row.id };
  }

  async requireById(reportId: string) {
    const [row] = await this.db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.REPORT_NOT_FOUND,
        message: 'That report no longer exists.',
      });
    }
    return row;
  }

  async resolve(
    reportId: string,
    adminId: string,
    status: ReportStatus.RESOLVED | ReportStatus.DISMISSED,
    note: string | undefined,
  ): Promise<void> {
    await this.db
      .update(reports)
      .set({ status, resolvedBy: adminId, resolvedAt: new Date(), resolutionNote: note ?? null })
      .where(eq(reports.id, reportId));
  }

  async openCount(): Promise<number> {
    const rows = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM ${reports} WHERE status = 'OPEN'`,
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Queue for the admin panel. The target preview is resolved with a correlated
   * subquery per target type so the moderator sees what was reported without an
   * extra round-trip.
   */
  async list(status: ReportStatus | undefined, limit = 100): Promise<ReportSummary[]> {
    const statusFilter = status ? sql`WHERE r.status = ${status}` : sql``;

    const rows = await this.db.execute<ReportQueryRow>(sql`
      SELECT
        r.id,
        r.target_type AS "targetType",
        r.target_id AS "targetId",
        r.reason,
        r.status,
        r.reporter_id AS "reporterId",
        ru.display_name AS "reporterName",
        CASE r.target_type
          WHEN 'LISTING' THEN (SELECT l.category || ' — ' || l.description FROM listings l WHERE l.id = r.target_id)
          WHEN 'MESSAGE' THEN (SELECT m.body FROM messages m WHERE m.id = r.target_id)
          WHEN 'USER' THEN (SELECT tu.display_name FROM users tu WHERE tu.id = r.target_id)
        END AS "targetPreview",
        r.created_at AS "createdAt",
        r.resolved_at AS "resolvedAt"
      FROM reports r
      JOIN users ru ON ru.id = r.reporter_id
      ${statusFilter}
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType as ReportTargetType,
      targetId: r.targetId,
      reason: r.reason,
      status: r.status as ReportStatus,
      reporterId: r.reporterId,
      reporterName: r.reporterName,
      targetPreview: r.targetPreview,
      createdAt: new Date(r.createdAt).toISOString(),
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    }));
  }
}
