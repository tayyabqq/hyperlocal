import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from '../src/health/health.controller';
import { DB } from '../src/db/db.module';
import { REDIS } from '../src/redis/redis.module';

describe('HealthController', () => {
  let controller: HealthController;
  let dbExecute: jest.Mock;
  let redisPing: jest.Mock;

  beforeEach(async () => {
    dbExecute = jest.fn().mockResolvedValue([]);
    redisPing = jest.fn().mockResolvedValue('PONG');

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DB, useValue: { execute: dbExecute } },
        { provide: REDIS, useValue: { ping: redisPing } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('reports ok when both dependencies respond', async () => {
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
    });
  });

  it('throws 503 when the database is unreachable — this is what pulls a broken instance out of ALB rotation', async () => {
    dbExecute.mockRejectedValueOnce(new Error('connection refused'));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
    // Redis must not even be checked once the hard dependency has failed.
    expect(redisPing).not.toHaveBeenCalled();
  });

  it('reports degraded (but still 200-eligible) when only Redis is unreachable', async () => {
    redisPing.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(controller.check()).resolves.toEqual({
      status: 'degraded',
      db: 'ok',
      redis: 'unreachable',
    });
  });
});
