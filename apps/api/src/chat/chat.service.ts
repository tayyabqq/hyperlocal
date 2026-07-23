import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import {
  AnalyticsEvent,
  ErrorCode,
  ListingStatus,
  MESSAGE_MAX_LENGTH,
  type ChatMessage,
  type ConversationMessagesResult,
  type ConversationSummary,
} from '@hl/shared';
import { DB, type Database } from '../db/db.module';
import { conversations, listings, messages, users } from '../db/schema';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  MESSAGE_SCREEN_PORT,
  type MessageScreen,
} from '../common/ports/message-screen.port';

const MESSAGE_PAGE_SIZE = 30;

export interface ConversationParticipants {
  id: string;
  authorId: string;
  inquirerId: string;
  listingId: string;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(MESSAGE_SCREEN_PORT) private readonly screen: MessageScreen,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Finds or creates the conversation for a listing from the caller's side.
   * Only a non-author may open one, and only against a live listing — a dead
   * or unpaid listing is not a place to start a conversation.
   */
  async startConversation(listingId: string, inquirerId: string): Promise<ConversationSummary> {
    const [listing] = await this.db
      .select({ id: listings.id, authorId: listings.authorId, status: listings.status })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new NotFoundException({
        errorCode: ErrorCode.LISTING_NOT_ACTIVE,
        message: 'This listing is no longer available.',
      });
    }

    if (listing.authorId === inquirerId) {
      throw new BadRequestException({
        errorCode: ErrorCode.CONVERSATION_WITH_SELF,
        message: 'You cannot message your own listing.',
      });
    }

    // ON CONFLICT makes concurrent first taps converge on one row.
    const [row] = await this.db
      .insert(conversations)
      .values({ listingId, authorId: listing.authorId, inquirerId })
      .onConflictDoUpdate({
        target: [conversations.listingId, conversations.inquirerId],
        set: { listingId },
      })
      .returning();

    await this.analytics.track(AnalyticsEvent.CONVERSATION_STARTED, inquirerId, {
      conversationId: row.id,
      listingId,
    });

    const [summary] = await this.summariesFor(inquirerId, row.id);
    return summary;
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    return this.summariesFor(userId, null);
  }

  /** Loads a conversation and asserts the caller is one of its two participants. */
  async requireParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationParticipants> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        authorId: conversations.authorId,
        inquirerId: conversations.inquirerId,
        listingId: conversations.listingId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        errorCode: ErrorCode.CONVERSATION_NOT_FOUND,
        message: 'This conversation no longer exists.',
      });
    }
    if (row.authorId !== userId && row.inquirerId !== userId) {
      throw new ForbiddenException({
        errorCode: ErrorCode.CONVERSATION_NOT_FOUND,
        message: 'This conversation no longer exists.',
      });
    }
    return row;
  }

  counterpartOf(conversation: ConversationParticipants, userId: string): string {
    return conversation.authorId === userId ? conversation.inquirerId : conversation.authorId;
  }

  /** Sender identity for push titles; read once per socket connection. */
  async displayNameOf(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.displayName?.trim() || 'New message';
  }

  /**
   * Persists a message after screening it. Returns the stored row; the gateway
   * is responsible for fan-out and push. Screening happens before the write so
   * a blocked message never reaches the database.
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    rawBody: string,
  ): Promise<ChatMessage> {
    await this.requireParticipant(conversationId, senderId);

    const body = rawBody.trim();
    if (body.length === 0 || body.length > MESSAGE_MAX_LENGTH) {
      throw new BadRequestException({
        errorCode: ErrorCode.MESSAGE_REJECTED,
        message: `Message must be between 1 and ${MESSAGE_MAX_LENGTH} characters.`,
      });
    }

    const verdict = this.screen.screen(body);
    if (!verdict.allowed) {
      await this.analytics.track(AnalyticsEvent.MESSAGE_BLOCKED, senderId, { conversationId });
      throw new BadRequestException({
        errorCode: ErrorCode.MESSAGE_REJECTED,
        message: verdict.reason ?? 'This message was blocked.',
      });
    }

    const [message] = await this.db
      .insert(messages)
      .values({ conversationId, senderId, body })
      .returning();

    await this.db
      .update(conversations)
      .set({ lastMessageAt: message.createdAt })
      .where(eq(conversations.id, conversationId));

    await this.analytics.track(AnalyticsEvent.MESSAGE_SENT, senderId, { conversationId });

    return toChatMessage(message);
  }

  async history(
    conversationId: string,
    userId: string,
    before?: string,
  ): Promise<ConversationMessagesResult> {
    await this.requireParticipant(conversationId, userId);

    const cursorFilter = before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, new Date(before)))
      : eq(messages.conversationId, conversationId);

    const rows = await this.db
      .select()
      .from(messages)
      .where(cursorFilter)
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(MESSAGE_PAGE_SIZE + 1);

    const hasMore = rows.length > MESSAGE_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows;

    return {
      // Ascending for display; the query runs descending so the cursor is cheap.
      messages: page.map(toChatMessage).reverse(),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  /** Marks the counterpart's messages as read. Returns how many flipped. */
  async markRead(conversationId: string, userId: string): Promise<number> {
    await this.requireParticipant(conversationId, userId);

    const updated = await this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.senderId, userId),
          sql`${messages.readAt} IS NULL`,
        ),
      )
      .returning({ id: messages.id });

    return updated.length;
  }

  /**
   * Builds conversation summaries for a user, optionally narrowed to one id.
   * Unread count and last-message preview are correlated subqueries so the list
   * is one round-trip.
   */
  private async summariesFor(
    userId: string,
    onlyId: string | null,
  ): Promise<ConversationSummary[]> {
    const idFilter = onlyId ? sql`AND c.id = ${onlyId}` : sql``;

    const rows = await this.db.execute<{
      id: string;
      listingId: string;
      listingCategory: string;
      counterpartId: string;
      counterpartName: string;
      lastMessagePreview: string | null;
      lastMessageAt: Date | string | null;
      unreadCount: number;
      createdAt: Date | string;
    }>(sql`
      SELECT
        c.id,
        c.listing_id AS "listingId",
        l.category AS "listingCategory",
        CASE WHEN c.author_id = ${userId} THEN c.inquirer_id ELSE c.author_id END AS "counterpartId",
        cu.display_name AS "counterpartName",
        (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS "lastMessagePreview",
        c.last_message_at AS "lastMessageAt",
        (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id
           AND m.sender_id <> ${userId} AND m.read_at IS NULL) AS "unreadCount",
        c.created_at AS "createdAt"
      FROM conversations c
      JOIN listings l ON l.id = c.listing_id
      JOIN users cu ON cu.id = CASE WHEN c.author_id = ${userId} THEN c.inquirer_id ELSE c.author_id END
      WHERE (c.author_id = ${userId} OR c.inquirer_id = ${userId}) ${idFilter}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT 100
    `);

    return rows.map((r) => ({
      id: r.id,
      listingId: r.listingId,
      listingCategory: r.listingCategory,
      counterpartId: r.counterpartId,
      counterpartName: r.counterpartName,
      lastMessagePreview: r.lastMessagePreview,
      lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
      unreadCount: r.unreadCount,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }
}

function toChatMessage(row: {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
