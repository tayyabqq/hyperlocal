import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AnalyticsEvent, ErrorCode, type UserProfile } from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
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
}
