import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminMetrics,
  AdminUserSummary,
  BlockedKeyword,
  ReportSummary,
} from '@hl/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';
import { ReportsService } from './reports.service';
import { ResolveReportDto } from './dto/resolve-report.dto';
import {
  AddKeywordDto,
  ListReportsQueryDto,
  ListUsersQueryDto,
  ModerationNoteDto,
} from './dto/admin-queries.dto';

/**
 * The admin surface. JwtAuthGuard authenticates; AdminGuard authorises against
 * the freshly-read admin flag. Every mutating action writes an audit row inside
 * AdminService — moderation is accountable by construction.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
    private readonly users: UsersService,
  ) {}

  @Get('metrics')
  metrics(): Promise<AdminMetrics> {
    return this.admin.metrics();
  }

  @Get('reports')
  listReports(@Query() query: ListReportsQueryDto): Promise<ReportSummary[]> {
    return this.reports.list(query.status);
  }

  @Post('reports/:id/resolve')
  @HttpCode(204)
  async resolveReport(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<void> {
    await this.admin.resolveReport(admin.id, id, dto.action, dto.note);
  }

  @Post('listings/:id/remove')
  @HttpCode(204)
  async removeListing(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<void> {
    await this.admin.killListing(admin.id, id, dto.note);
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto): Promise<AdminUserSummary[]> {
    return this.users.adminList(query.search);
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserSummary> {
    return this.users.adminGet(id);
  }

  @Post('users/:id/ban')
  @HttpCode(204)
  async banUser(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<void> {
    await this.admin.banUser(admin.id, id, dto.note);
  }

  @Post('users/:id/unban')
  @HttpCode(204)
  async unbanUser(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<void> {
    await this.admin.unbanUser(admin.id, id, dto.note);
  }

  @Get('keywords')
  listKeywords(): Promise<BlockedKeyword[]> {
    return this.admin.listKeywords();
  }

  @Post('keywords')
  @HttpCode(204)
  async addKeyword(@Body() dto: AddKeywordDto): Promise<void> {
    await this.admin.addKeyword(dto.term);
  }

  @Delete('keywords/:id')
  @HttpCode(204)
  async removeKeyword(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.admin.removeKeyword(id);
  }
}
