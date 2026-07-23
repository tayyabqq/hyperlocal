import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  ChatMessage,
  ConversationMessagesResult,
  ConversationSummary,
} from '@hl/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ChatService } from './chat.service';
import { ChatDeliveryService } from './chat-delivery.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

/**
 * REST surface for chat. Real-time delivery is the socket gateway's job; these
 * endpoints cover conversation setup, history paging, read receipts, and a
 * send fallback for clients not holding a live socket. Both send paths run
 * through ChatDeliveryService so fan-out and push happen once either way.
 */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly delivery: ChatDeliveryService,
  ) {}

  @Post('conversations')
  startConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartConversationDto,
  ): Promise<ConversationSummary> {
    return this.chat.startConversation(dto.listingId, user.id);
  }

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthenticatedUser): Promise<ConversationSummary[]> {
    return this.chat.listConversations(user.id);
  }

  @Get('conversations/:id/messages')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
  ): Promise<ConversationMessagesResult> {
    return this.chat.history(id, user.id, query.before);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('conversations/:id/messages')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<ChatMessage> {
    const conversation = await this.chat.requireParticipant(id, user.id);
    const message = await this.chat.sendMessage(id, user.id, dto.body);
    await this.delivery.deliver(message, conversation, user.displayName);
    return message;
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const conversation = await this.chat.requireParticipant(id, user.id);
    const changed = await this.chat.markRead(id, user.id);
    if (changed > 0) this.delivery.notifyRead(conversation, user.id);
  }
}
