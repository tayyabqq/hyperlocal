import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ListingStatus } from '@hl/shared';
import { ChatService } from '../src/chat/chat.service';
import { DB } from '../src/db/db.module';
import { MESSAGE_SCREEN_PORT } from '../src/common/ports/message-screen.port';
import { AnalyticsService } from '../src/analytics/analytics.service';

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

function insertChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    values: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

function updateChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

describe('ChatService', () => {
  let service: ChatService;
  let dbSelect: jest.Mock;
  let dbInsert: jest.Mock;
  let dbUpdate: jest.Mock;
  let dbExecute: jest.Mock;
  let screen: jest.Mock;
  let track: jest.Mock;

  const listingRow = { id: 'listing-1', authorId: 'author-1', status: ListingStatus.ACTIVE };

  beforeEach(async () => {
    dbSelect = jest.fn();
    dbInsert = jest.fn();
    dbUpdate = jest.fn().mockReturnValue(updateChain([]));
    dbExecute = jest.fn().mockResolvedValue([]);
    screen = jest.fn().mockReturnValue({ allowed: true });
    track = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: DB,
          useValue: { select: dbSelect, insert: dbInsert, update: dbUpdate, execute: dbExecute },
        },
        { provide: MESSAGE_SCREEN_PORT, useValue: { screen } },
        { provide: AnalyticsService, useValue: { track } },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('startConversation', () => {
    it('rejects a listing that is not active', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ ...listingRow, status: ListingStatus.EXPIRED }]));

      await expect(service.startConversation('listing-1', 'inquirer-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to let an author message their own listing', async () => {
      dbSelect.mockReturnValueOnce(selectChain([listingRow]));

      await expect(service.startConversation('listing-1', 'author-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates (or reuses) the conversation and records the time-to-first-chat event', async () => {
      dbSelect.mockReturnValueOnce(selectChain([listingRow]));
      dbInsert.mockReturnValueOnce(
        insertChain([{ id: 'conv-1', listingId: 'listing-1', authorId: 'author-1', inquirerId: 'inquirer-1' }]),
      );
      dbExecute.mockResolvedValueOnce([
        {
          id: 'conv-1',
          listingId: 'listing-1',
          listingCategory: 'Warehouse helper',
          counterpartId: 'author-1',
          counterpartName: 'Rashid',
          lastMessagePreview: null,
          lastMessageAt: null,
          unreadCount: 0,
          createdAt: new Date(),
        },
      ]);

      const summary = await service.startConversation('listing-1', 'inquirer-1');

      expect(summary.id).toBe('conv-1');
      expect(track).toHaveBeenCalledWith(
        'conversation_started',
        'inquirer-1',
        expect.objectContaining({ conversationId: 'conv-1' }),
      );
    });
  });

  describe('requireParticipant', () => {
    const convRow = {
      id: 'conv-1',
      authorId: 'author-1',
      inquirerId: 'inquirer-1',
      listingId: 'listing-1',
    };

    it('allows a participant', async () => {
      dbSelect.mockReturnValueOnce(selectChain([convRow]));
      await expect(service.requireParticipant('conv-1', 'inquirer-1')).resolves.toEqual(convRow);
    });

    it('rejects a non-participant as if the conversation did not exist', async () => {
      dbSelect.mockReturnValueOnce(selectChain([convRow]));
      await expect(service.requireParticipant('conv-1', 'stranger')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a missing conversation', async () => {
      dbSelect.mockReturnValueOnce(selectChain([]));
      await expect(service.requireParticipant('conv-x', 'inquirer-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sendMessage', () => {
    const convRow = {
      id: 'conv-1',
      authorId: 'author-1',
      inquirerId: 'inquirer-1',
      listingId: 'listing-1',
    };

    it('blocks a message the screen rejects, before writing it', async () => {
      dbSelect.mockReturnValueOnce(selectChain([convRow]));
      screen.mockReturnValueOnce({ allowed: false, reason: 'blocked term' });

      await expect(service.sendMessage('conv-1', 'author-1', 'bad words')).rejects.toThrow(
        BadRequestException,
      );
      expect(dbInsert).not.toHaveBeenCalled();
    });

    it('rejects an empty message', async () => {
      dbSelect.mockReturnValueOnce(selectChain([convRow]));

      await expect(service.sendMessage('conv-1', 'author-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('persists a valid message and bumps the conversation', async () => {
      dbSelect.mockReturnValueOnce(selectChain([convRow]));
      const created = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'author-1',
        body: 'Hello there',
        createdAt: new Date(),
        readAt: null,
      };
      dbInsert.mockReturnValueOnce({ values: () => ({ returning: () => Promise.resolve([created]) }) });

      const message = await service.sendMessage('conv-1', 'author-1', '  Hello there  ');

      expect(message.body).toBe('Hello there');
      expect(dbUpdate).toHaveBeenCalled(); // last_message_at bumped
      expect(track).toHaveBeenCalledWith('message_sent', 'author-1', { conversationId: 'conv-1' });
    });
  });

  describe('markRead', () => {
    it('flips the counterpart’s unread messages and reports the count', async () => {
      dbSelect.mockReturnValueOnce(
        selectChain([
          { id: 'conv-1', authorId: 'author-1', inquirerId: 'inquirer-1', listingId: 'listing-1' },
        ]),
      );
      dbUpdate.mockReturnValueOnce(updateChain([{ id: 'm1' }, { id: 'm2' }]));

      await expect(service.markRead('conv-1', 'inquirer-1')).resolves.toBe(2);
    });
  });
});
