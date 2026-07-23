import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ModerationAction, ReportStatus, ReportTargetType } from '@hl/shared';
import { AdminService } from '../src/moderation/admin.service';
import { ReportsService } from '../src/moderation/reports.service';
import { KeywordBlacklistService } from '../src/moderation/keyword-blacklist.service';
import { KeywordMessageScreen } from '../src/moderation/keyword-message-screen';
import { DB } from '../src/db/db.module';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ListingsService } from '../src/listings/listings.service';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('KeywordBlacklistService.firstMatch', () => {
  async function withTerms(terms: string[]): Promise<KeywordBlacklistService> {
    const select = () => ({
      from: () => ({ orderBy: () => Promise.resolve(terms.map((term) => ({ term }))) }),
    });
    const service = new KeywordBlacklistService({ select } as never);
    await service.refresh();
    return service;
  }

  it('matches case- and whitespace-insensitively', async () => {
    const service = await withTerms(['western union']);
    expect(service.firstMatch('Pay me by  Western   Union now')).toBe('western union');
    expect(service.firstMatch('Meet at the shop at 4pm')).toBeNull();
  });
});

describe('KeywordMessageScreen', () => {
  it('blocks when the blacklist matches and allows otherwise', () => {
    const blacklist = { firstMatch: (t: string) => (t.includes('scam') ? 'scam' : null) };
    const screen = new KeywordMessageScreen(blacklist as unknown as KeywordBlacklistService);

    expect(screen.screen('this is a scam').allowed).toBe(false);
    expect(screen.screen('this is fine').allowed).toBe(true);
  });

  it('does not reveal which term tripped the filter', () => {
    const blacklist = { firstMatch: () => 'western union' };
    const screen = new KeywordMessageScreen(blacklist as unknown as KeywordBlacklistService);

    expect(screen.screen('anything').reason).not.toContain('western union');
  });
});

describe('AdminService', () => {
  let service: AdminService;
  let removeByModerator: jest.Mock;
  let removeAllByAuthor: jest.Mock;
  let banUser: jest.Mock;
  let unbanUser: jest.Mock;
  let revokeAllSessions: jest.Mock;
  let requireById: jest.Mock;
  let resolveReport: jest.Mock;
  let dbInsert: jest.Mock;
  let dbExecute: jest.Mock;
  let track: jest.Mock;

  beforeEach(async () => {
    removeByModerator = jest.fn().mockResolvedValue(true);
    removeAllByAuthor = jest.fn().mockResolvedValue(1);
    banUser = jest.fn().mockResolvedValue(true);
    unbanUser = jest.fn().mockResolvedValue(true);
    revokeAllSessions = jest.fn().mockResolvedValue(undefined);
    requireById = jest.fn();
    resolveReport = jest.fn().mockResolvedValue(undefined);
    dbInsert = jest.fn().mockReturnValue({ values: () => Promise.resolve([]) });
    dbExecute = jest.fn().mockResolvedValue([]);
    track = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: DB, useValue: { insert: dbInsert, execute: dbExecute } },
        { provide: ReportsService, useValue: { requireById, resolve: resolveReport } },
        { provide: ListingsService, useValue: { removeByModerator, removeAllByAuthor } },
        { provide: UsersService, useValue: { ban: banUser, unban: unbanUser } },
        { provide: AuthService, useValue: { revokeAllSessions } },
        {
          provide: KeywordBlacklistService,
          useValue: { list: jest.fn(), add: jest.fn(), remove: jest.fn() },
        },
        { provide: AnalyticsService, useValue: { track } },
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('killListing', () => {
    it('removes the listing and writes an audit row', async () => {
      await service.killListing('admin-1', 'listing-1', 'scam');

      expect(removeByModerator).toHaveBeenCalledWith('listing-1');
      expect(dbInsert).toHaveBeenCalled(); // moderation_actions audit
    });

    it('404s when the listing does not exist', async () => {
      removeByModerator.mockResolvedValueOnce(false);
      await expect(service.killListing('admin-1', 'gone')).rejects.toThrow(NotFoundException);
    });
  });

  describe('banUser', () => {
    it('bans, revokes sessions, and audits', async () => {
      await service.banUser('admin-1', 'user-9', 'abuse');

      expect(banUser).toHaveBeenCalledWith('user-9', 'abuse');
      expect(revokeAllSessions).toHaveBeenCalledWith('user-9');
      expect(removeAllByAuthor).toHaveBeenCalledWith('user-9'); // listings leave the map too
    });

    it('refuses to let an admin ban themselves', async () => {
      await expect(service.banUser('admin-1', 'admin-1')).rejects.toThrow(BadRequestException);
      expect(banUser).not.toHaveBeenCalled();
    });
  });

  describe('resolveReport', () => {
    it('kills the reported listing and marks the report resolved', async () => {
      requireById.mockResolvedValueOnce({
        id: 'rep-1',
        targetType: ReportTargetType.LISTING,
        targetId: 'listing-1',
      });

      await service.resolveReport('admin-1', 'rep-1', ModerationAction.KILL_LISTING, 'spam');

      expect(removeByModerator).toHaveBeenCalledWith('listing-1');
      expect(resolveReport).toHaveBeenCalledWith(
        'rep-1',
        'admin-1',
        ReportStatus.RESOLVED,
        'spam',
      );
    });

    it('rejects KILL_LISTING on a report that is not about a listing', async () => {
      requireById.mockResolvedValueOnce({
        id: 'rep-2',
        targetType: ReportTargetType.USER,
        targetId: 'user-2',
      });

      await expect(
        service.resolveReport('admin-1', 'rep-2', ModerationAction.KILL_LISTING),
      ).rejects.toThrow(BadRequestException);
    });

    it('bans the offending author when resolving a listing report with BAN_USER', async () => {
      requireById.mockResolvedValueOnce({
        id: 'rep-3',
        targetType: ReportTargetType.LISTING,
        targetId: 'listing-3',
      });
      dbExecute.mockResolvedValueOnce([{ userId: 'author-3' }]); // resolveOffendingUser lookup

      await service.resolveReport('admin-1', 'rep-3', ModerationAction.BAN_USER, 'repeat scammer');

      expect(banUser).toHaveBeenCalledWith('author-3', 'repeat scammer');
      expect(resolveReport).toHaveBeenCalledWith(
        'rep-3',
        'admin-1',
        ReportStatus.RESOLVED,
        'repeat scammer',
      );
    });

    it('dismisses without taking any action', async () => {
      requireById.mockResolvedValueOnce({
        id: 'rep-4',
        targetType: ReportTargetType.LISTING,
        targetId: 'listing-4',
      });

      await service.resolveReport('admin-1', 'rep-4', ModerationAction.DISMISS);

      expect(removeByModerator).not.toHaveBeenCalled();
      expect(banUser).not.toHaveBeenCalled();
      expect(resolveReport).toHaveBeenCalledWith(
        'rep-4',
        'admin-1',
        ReportStatus.DISMISSED,
        undefined,
      );
    });
  });
});
