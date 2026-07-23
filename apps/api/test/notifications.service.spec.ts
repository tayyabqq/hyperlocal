import { Test } from '@nestjs/testing';
import { DevicePlatform } from '@hl/shared';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PUSH_PROVIDER } from '../src/notifications/push-provider.interface';
import { DB } from '../src/db/db.module';
import { AnalyticsService } from '../src/analytics/analytics.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let dbSelect: jest.Mock;
  let dbDelete: jest.Mock;
  let deleteWhere: jest.Mock;
  let send: jest.Mock;
  let track: jest.Mock;

  function selectReturning(rows: unknown[]) {
    return { from: () => ({ where: () => Promise.resolve(rows) }) };
  }

  beforeEach(async () => {
    dbSelect = jest.fn();
    deleteWhere = jest.fn().mockResolvedValue(undefined);
    dbDelete = jest.fn().mockReturnValue({ where: deleteWhere });
    send = jest.fn().mockResolvedValue({ invalidTokens: [] });
    track = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: DB, useValue: { select: dbSelect, delete: dbDelete } },
        { provide: PUSH_PROVIDER, useValue: { send } },
        { provide: AnalyticsService, useValue: { track } },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when the user has no registered devices', async () => {
    dbSelect.mockReturnValueOnce(selectReturning([]));

    await service.notifyUser('user-1', { title: 'Hi', body: 'there' });

    expect(send).not.toHaveBeenCalled();
  });

  it('sends to every device and records analytics', async () => {
    dbSelect.mockReturnValueOnce(
      selectReturning([
        { token: 'tok-a', platform: DevicePlatform.ANDROID },
        { token: 'tok-b', platform: DevicePlatform.ANDROID },
      ]),
    );

    await service.notifyUser('user-1', { title: 'New message', body: 'Hello' });

    expect(send).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ token: 'tok-a' })]),
      expect.objectContaining({ title: 'New message' }),
    );
    expect(track).toHaveBeenCalledWith(
      'push_sent',
      'user-1',
      expect.objectContaining({ delivered: 2 }),
    );
  });

  it('prunes tokens the provider reports as dead', async () => {
    dbSelect.mockReturnValueOnce(selectReturning([{ token: 'tok-dead', platform: 'ANDROID' }]));
    send.mockResolvedValueOnce({ invalidTokens: ['tok-dead'] });

    await service.notifyUser('user-1', { title: 'Hi', body: 'there' });

    expect(dbDelete).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });

  it('never throws even if the push provider blows up', async () => {
    dbSelect.mockReturnValueOnce(selectReturning([{ token: 'tok-a', platform: 'ANDROID' }]));
    send.mockRejectedValueOnce(new Error('provider exploded'));

    await expect(
      service.notifyUser('user-1', { title: 'Hi', body: 'there' }),
    ).resolves.toBeUndefined();
  });
});
