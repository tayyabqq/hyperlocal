import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ListingsService } from '../src/listings/listings.service';
import { DB } from '../src/db/db.module';
import { REDIS } from '../src/redis/redis.module';
import { AnalyticsService } from '../src/analytics/analytics.service';

/** Minimal thenable stand-in for a Drizzle update-chain used by expireOverdueListings. */
function updateChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

describe('ListingsService', () => {
  let service: ListingsService;
  let execute: jest.Mock;
  let dbUpdate: jest.Mock;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;
  let redisKeys: jest.Mock;
  let redisDel: jest.Mock;
  let track: jest.Mock;

  const dubai = { latitude: 25.2582, longitude: 55.3047 }; // Deira

  const validDto = {
    category: 'Warehouse helper',
    payAmountAed: 120,
    description: 'Load and unload boxes for a half-day shift, starting this afternoon.',
    latitude: dubai.latitude,
    longitude: dubai.longitude,
    locationLabel: 'Al Murar, Deira',
  };

  beforeEach(async () => {
    execute = jest.fn();
    dbUpdate = jest.fn();
    redisGet = jest.fn().mockResolvedValue(null);
    redisSet = jest.fn().mockResolvedValue('OK');
    redisKeys = jest.fn().mockResolvedValue([]);
    redisDel = jest.fn().mockResolvedValue(0);
    track = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: DB, useValue: { execute, update: dbUpdate } },
        { provide: REDIS, useValue: { get: redisGet, set: redisSet, keys: redisKeys, del: redisDel } },
        { provide: AnalyticsService, useValue: { track } },
      ],
    }).compile();

    service = moduleRef.get(ListingsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects coordinates outside the UAE before touching the database', async () => {
      const outsideUae = { ...validDto, latitude: 51.5072, longitude: -0.1276 }; // London

      await expect(service.create('user-1', 'PROVIDER' as never, outsideUae)).rejects.toThrow(
        BadRequestException,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it('inserts via raw SQL using ST_MakePoint and returns the created listing', async () => {
      execute
        .mockResolvedValueOnce([{ id: 'listing-1' }]) // INSERT ... RETURNING id
        .mockResolvedValueOnce([
          {
            id: 'listing-1',
            authorId: 'user-1',
            authorRole: 'PROVIDER',
            authorDisplayName: 'Rashid',
            category: validDto.category,
            payAmountAed: validDto.payAmountAed,
            description: validDto.description,
            latitude: validDto.latitude,
            longitude: validDto.longitude,
            locationLabel: validDto.locationLabel,
            status: 'ACTIVE',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
            distanceMeters: null,
          },
        ]); // findById SELECT

      const result = await service.create('user-1', 'PROVIDER' as never, validDto);

      expect(result.id).toBe('listing-1');
      expect(result.status).toBe('ACTIVE');
      expect(track).toHaveBeenCalledWith(
        'listing_created',
        'user-1',
        expect.objectContaining({ category: validDto.category }),
      );
      // Cache invalidated on write so a browse immediately after create is fresh.
      expect(redisKeys).toHaveBeenCalledWith('browse:*');
    });

    it('throws if the insert unexpectedly returns no row', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.create('user-1', 'PROVIDER' as never, validDto)).rejects.toThrow(
        'Listing insert did not return an id',
      );
    });
  });

  describe('browse', () => {
    it('serves from Redis when a cache entry exists, skipping the DB', async () => {
      const cached = { listings: [], radiusMeters: 2000 };
      redisGet.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.browse(dubai.latitude, dubai.longitude);

      expect(result).toEqual(cached);
      expect(execute).not.toHaveBeenCalled();
    });

    it('queries with ST_DWithin on a cache miss and populates the cache', async () => {
      execute.mockResolvedValueOnce([
        {
          id: 'listing-1',
          authorId: 'user-1',
          authorRole: 'PROVIDER',
          authorDisplayName: 'Rashid',
          category: 'Warehouse helper',
          payAmountAed: 120,
          description: 'desc',
          latitude: dubai.latitude,
          longitude: dubai.longitude,
          locationLabel: 'Al Murar, Deira',
          status: 'ACTIVE',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
          distanceMeters: 340.7,
        },
      ]);

      const result = await service.browse(dubai.latitude, dubai.longitude, 2000);

      expect(result.listings).toHaveLength(1);
      expect(result.listings[0].distanceMeters).toBe(341); // rounded
      expect(redisSet).toHaveBeenCalledWith(
        expect.stringContaining('browse:25.258'),
        expect.any(String),
        'EX',
        20,
      );
    });

    it('falls back to the database if Redis is unavailable, without throwing', async () => {
      redisGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      execute.mockResolvedValueOnce([]);

      await expect(service.browse(dubai.latitude, dubai.longitude)).resolves.toEqual({
        listings: [],
        radiusMeters: 2000,
      });
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when the listing does not exist', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.findById('missing', null)).rejects.toThrow(NotFoundException);
    });
  });

  describe('expireOverdueListings', () => {
    it('marks overdue ACTIVE listings as EXPIRED and invalidates the cache', async () => {
      dbUpdate.mockReturnValue(updateChain([{ id: 'listing-1' }, { id: 'listing-2' }]));

      const count = await service.expireOverdueListings();

      expect(count).toBe(2);
      expect(redisKeys).toHaveBeenCalledWith('browse:*');
    });

    it('does not touch the cache when nothing expired', async () => {
      dbUpdate.mockReturnValue(updateChain([]));

      const count = await service.expireOverdueListings();

      expect(count).toBe(0);
      expect(redisKeys).not.toHaveBeenCalled();
    });
  });
});
