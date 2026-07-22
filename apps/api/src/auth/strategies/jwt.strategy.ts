import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { eq } from 'drizzle-orm';
import { ErrorCode, type UserRole } from '@hl/shared';
import { DB, type Database } from '../../db/db.module';
import { users } from '../../db/schema';

export interface JwtPayload {
  sub: string;
}

export interface AuthenticatedUser {
  id: string;
  phoneE164: string;
  displayName: string;
  role: UserRole;
  isProfileComplete: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(DB) private readonly db: Database,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_PUBLIC_KEY'),
      algorithms: ['RS256'],
    });
  }

  /**
   * Role and profile state are read from the database on every request rather
   * than trusted from the token, so a role change takes effect immediately
   * instead of waiting for the 15-minute access token to expire.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const [row] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);

    if (!row) {
      throw new UnauthorizedException({
        errorCode: ErrorCode.USER_NOT_FOUND,
        message: 'Session is no longer valid. Please log in again.',
      });
    }

    return {
      id: row.id,
      phoneE164: row.phoneE164,
      displayName: row.displayName,
      role: row.role as UserRole,
      isProfileComplete: row.isProfileComplete,
    };
  }
}
