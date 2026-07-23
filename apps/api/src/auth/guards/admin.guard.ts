import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '@hl/shared';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Gates the admin surface. Must be used *after* JwtAuthGuard so `request.user`
 * is populated; the admin flag is read fresh from the DB on every request by
 * the JWT strategy, so revoking admin takes effect immediately.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.isAdmin) {
      throw new ForbiddenException({
        errorCode: ErrorCode.FORBIDDEN,
        message: 'Administrator access is required.',
      });
    }
    return true;
  }
}
