import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  ModerationAction,
  ReportStatus,
  ReportTargetType,
  type AdminMetrics,
  type BlockedKeyword,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { moderationActions } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import { ListingsService } from '../listings/listings.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { ReportsService } from './reports.service';
import { KeywordBlacklistService } from './keyword-blacklist.service';

const AuditAction = {
  KILL_LISTING: 'KILL_LISTING',
  BAN_USER: 'BAN_USER',
  UNBAN_USER: 'UNBAN_USER',
  RESOLVE_REPORT: 'RESOLVE_REPORT',
} as const;

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reports: ReportsService,
    private readonly listings: ListingsService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly keywords: KeywordBlacklistService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Takes a listing off the map and records who did it. */
  async killListing(adminId: string, listingId: string, note?: string): Promise<void> {
    const removed = await this.listings.removeByModerator(listingId);
    if (!removed) {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_FOUND,
        message: 'That listing no longer exists.',
      });
    }
    await this.audit(adminId, AuditAction.KILL_LISTING, ReportTargetType.LISTING, listingId, note);
    await this.analytics.track(AnalyticsEvent.LISTING_MODERATED, adminId, { listingId });
  }

  /** Bans an account and kills its live sessions immediately. */
  async banUser(adminId: string, userId: string, note?: string): Promise<void> {
    if (userId === adminId) {
      throw new BadRequestException({
        errorCode: ErrorCode.FORBIDDEN,
        message: 'You cannot ban your own account.',
      });
    }
    const banned = await this.users.ban(userId, note ?? 'Policy violation');
    if (!banned) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'That account no longer exists.',
      });
    }
    // Existing access tokens live up to 15 minutes; revoking refresh tokens
    // stops them re-authing, and the per-request ban check blocks the rest.
    await this.auth.revokeAllSessions(userId);
    // A banned account's listings leave the map with it.
    await this.listings.removeAllByAuthor(userId);
    await this.audit(adminId, AuditAction.BAN_USER, ReportTargetType.USER, userId, note);
    await this.analytics.track(AnalyticsEvent.USER_BANNED, adminId, { userId });
  }

  async unbanUser(adminId: string, userId: string, note?: string): Promise<void> {
    const unbanned = await this.users.unban(userId);
    if (!unbanned) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'That account no longer exists.',
      });
    }
    await this.audit(adminId, AuditAction.UNBAN_USER, ReportTargetType.USER, userId, note);
  }

  /**
   * Clears a report and, in the same step, performs the moderator's chosen
   * action. The report target drives what BAN_USER/KILL_LISTING operate on.
   */
  async resolveReport(
    adminId: string,
    reportId: string,
    action: ModerationAction,
    note?: string,
  ): Promise<void> {
    const report = await this.reports.requireById(reportId);

    if (action === ModerationAction.KILL_LISTING) {
      if (report.targetType !== ReportTargetType.LISTING) {
        throw new BadRequestException({
          errorCode: ErrorCode.VALIDATION_FAILED,
          message: 'This report is not about a listing.',
        });
      }
      await this.killListing(adminId, report.targetId, note);
    } else if (action === ModerationAction.BAN_USER) {
      const userId = await this.resolveOffendingUser(report.targetType, report.targetId);
      await this.banUser(adminId, userId, note);
    }

    const status =
      action === ModerationAction.DISMISS ? ReportStatus.DISMISSED : ReportStatus.RESOLVED;
    await this.reports.resolve(reportId, adminId, status, note);
    await this.audit(adminId, AuditAction.RESOLVE_REPORT, ReportTargetType.USER, reportId, action);
  }

  async metrics(): Promise<AdminMetrics> {
    const [row] = await this.db.execute<AdminMetrics & Record<string, unknown>>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS "totalUsers",
        (SELECT COUNT(*)::int FROM users WHERE banned_at IS NOT NULL) AS "bannedUsers",
        (SELECT COUNT(*)::int FROM listings WHERE status = 'ACTIVE') AS "activeListings",
        (SELECT COUNT(*)::int FROM listings WHERE created_at >= now() - interval '7 days') AS "listingsLast7Days",
        (SELECT COUNT(DISTINCT po.listing_id)::int FROM payment_orders po
           JOIN listings l ON l.id = po.listing_id
           WHERE po.status = 'PAID' AND l.created_at >= now() - interval '7 days') AS "paidListingsLast7Days",
        (SELECT COUNT(*)::int FROM conversations WHERE created_at >= now() - interval '7 days') AS "conversationsLast7Days",
        (SELECT COUNT(*)::int FROM messages WHERE created_at >= now() - interval '7 days') AS "messagesLast7Days",
        (SELECT COUNT(*)::int FROM reports WHERE status = 'OPEN') AS "openReports"
    `);

    const paidConversionPct =
      row.listingsLast7Days > 0
        ? Math.round((row.paidListingsLast7Days / row.listingsLast7Days) * 100)
        : 0;

    return { ...row, paidConversionPct };
  }

  async listKeywords(): Promise<BlockedKeyword[]> {
    const rows = await this.keywords.list();
    return rows.map((r) => ({ id: r.id, term: r.term, createdAt: r.createdAt.toISOString() }));
  }

  addKeyword(term: string): Promise<void> {
    return this.keywords.add(term);
  }

  removeKeyword(id: string): Promise<void> {
    return this.keywords.remove(id);
  }

  /** Maps a report target to the user who should be banned for it. */
  private async resolveOffendingUser(targetType: string, targetId: string): Promise<string> {
    if (targetType === ReportTargetType.USER) return targetId;

    const table = targetType === ReportTargetType.LISTING ? 'listings' : 'messages';
    const column = targetType === ReportTargetType.LISTING ? 'author_id' : 'sender_id';
    const rows = await this.db.execute<{ userId: string }>(
      sql`SELECT ${sql.raw(column)} AS "userId" FROM ${sql.raw(table)} WHERE id = ${targetId} LIMIT 1`,
    );
    const userId = rows[0]?.userId;
    if (!userId) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'The reported content no longer exists.',
      });
    }
    return userId;
  }

  private async audit(
    adminId: string,
    action: string,
    targetType: ReportTargetType,
    targetId: string,
    note?: string,
  ): Promise<void> {
    await this.db.insert(moderationActions).values({
      adminId,
      action,
      targetType,
      targetId,
      note: note ?? null,
    });
  }
}
