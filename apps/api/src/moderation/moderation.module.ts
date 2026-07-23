import { Global, Module } from '@nestjs/common';
import { MESSAGE_SCREEN_PORT } from '../common/ports/message-screen.port';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ListingsModule } from '../listings/listings.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { KeywordBlacklistService } from './keyword-blacklist.service';
import { KeywordMessageScreen } from './keyword-message-screen';

/**
 * Global so it can supply MESSAGE_SCREEN_PORT to the chat module without chat
 * importing moderation — chat depends only on the port, and this module fills
 * it. Moderation is allowed to import listings/users/auth (they never import
 * moderation), which keeps the dependency direction one-way.
 */
@Global()
@Module({
  imports: [AuthModule, UsersModule, ListingsModule],
  controllers: [AdminController, ReportsController],
  providers: [
    AdminService,
    ReportsService,
    KeywordBlacklistService,
    { provide: MESSAGE_SCREEN_PORT, useClass: KeywordMessageScreen },
  ],
  exports: [MESSAGE_SCREEN_PORT],
})
export class ModerationModule {}
