import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

/**
 * Any authenticated user can report a listing, message, or account. Reporting
 * is the community trust backstop (P5), so the flow is deliberately one tap —
 * the throttle only stops automated abuse.
 */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post()
  @HttpCode(202)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<{ id: string }> {
    return this.reports.create(user.id, dto.targetType, dto.targetId, dto.reason);
  }
}
