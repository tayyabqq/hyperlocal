import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'notifications/devices', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(204)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    await this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  @Delete()
  @HttpCode(204)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    await this.notifications.unregisterDevice(user.id, dto.token);
  }
}
