import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, ilike, or } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  type AdminUserSummary,
  type UserProfile,
  type UserRole,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { users, type UserRow } from '../db/schema';
import { toUserProfile } from '../auth/auth.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type { CompleteProfileDto } from '../auth/dto/complete-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly analytics: AnalyticsService,
  ) {}

  async getById(userId: string): Promise<UserProfile> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'We could not find that account.',
      });
    }
    return toUserProfile(row);
  }

  async completeProfile(userId: string, dto: CompleteProfileDto): Promise<UserProfile> {
    const [row] = await this.db
      .update(users)
      .set({
        displayName: dto.displayName.trim(),
        role: dto.role,
        isProfileComplete: true,
        lastActiveAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'We could not find that account.',
      });
    }

    await this.analytics.track(AnalyticsEvent.PROFILE_COMPLETED, userId, { role: dto.role });
    return toUserProfile(row);
  }

  /**
   * Bans an account. The JWT strategy reads `bannedAt` on every request, so the
   * ban bites on the user's next call; returns whether a row changed so the
   * caller can 404 an unknown id.
   */
  async ban(userId: string, reason: string): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ bannedAt: new Date(), bannedReason: reason.slice(0, 500) })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async unban(userId: string): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({ bannedAt: null, bannedReason: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async adminList(search: string | undefined, limit = 50): Promise<AdminUserSummary[]> {
    const query = this.db.select().from(users);
    const rows = search
      ? await query
          .where(
            or(ilike(users.displayName, `%${search}%`), ilike(users.phoneE164, `%${search}%`)),
          )
          .orderBy(desc(users.createdAt))
          .limit(limit)
      : await query.orderBy(desc(users.createdAt)).limit(limit);
    return rows.map(toAdminSummary);
  }

  async adminGet(userId: string): Promise<AdminUserSummary> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'We could not find that account.',
      });
    }
    return toAdminSummary(row);
  }
}

function toAdminSummary(row: UserRow): AdminUserSummary {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    role: row.role as UserRole,
    isAdmin: row.isAdmin,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
    createdAt: row.createdAt.toISOString(),
  };
}
