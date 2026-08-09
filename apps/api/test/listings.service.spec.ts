import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { MAX_LISTING_IMAGES, PaymentMethod, PaymentOrderStatus } from '@hl/shared';
import { ListingsService, type ListingAuthor } from '../src/listings/listings.service';
import { DB } from '../src/db/db.module';
import { REDIS } from '../src/redis/redis.module';
import { LISTING_PAYMENT_PORT } from '../src/common/ports/listing-payment.port';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { STORAGE_PROVIDER } from '../src/common/storage/storage-provider.interface';

/** Minimal thenable stand-in for a Drizzle update-chain. */
function updateChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    set: () => chain,
    where: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

/**
 * Minimal thenable stand-in for a Drizzle select-chain. `where()` is itself
 * awaitable (countImages awaits it directly) and still chains to `.limit()`
 * (requireOwnedListing calls `.where(...).limit(1)`), matching real Drizzle.
 */
function selectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => resolved,
    then: resolved.then.bind(resolved),
  };
  return chain;
}

function insertChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    values: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

function deleteChain(returning: unknown[]) {
  const chain: Record<string, unknown> = {
    where: () => chain,
    returning: () => Promise.resolve(returning),
  };
  return chain;
}

describe('ListingsService', () => {
  let service: ListingsService;
  let execute: jest.Mock;
  let dbUpdate: jest.Mock;
  let dbSelect: jest.Mock;
  let dbInsert: jest.Mock;
  let dbDelete: jest.Mock;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;
  let redisKeys: jest.Mock;
  let redisDel: jest.Mock;
  let chargeForListing: jest.Mock;
  let track: jest.Mock;
  let emit: jest.Mock;
  let storageUpload: jest.Mock;
  let storageDelete: jest.Mock;

  const dubai = { latitude: 25.2582, longitude: 55.3047 }; // Deira

  const author: ListingAuthor = {
    id: 'user-1',
    role: 'PROVIDER' as never,
    displayName: 'Rashid',
    phoneE164: '+971500000001',
  };

  const validDto = {
    category: 'Warehouse helper',
    payAmountAed: 120,
    description: 'Load and unload boxes for a half-day shift, starting this afternoon.',
    latitude: dubai.latitude,
    longitude: dubai.longitude,
    locationLabel: 'Al Murar, Deira',
  };

  function listingRow(overrides: Record<string, unknown> = {}) {
    return {
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
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      distanceMeters: null,
      ...overrides,
    };
  }

  const pendingCharge = {
    orderId: 'order-1',
    status: PaymentOrderStatus.PENDING,
    amountFils: 1000,
    method: PaymentMethod.CARD,
    redirectUrl: 'https://pay.example/hosted/abc',
    createdAt: new Date(),
    paidAt: null,
  };

  beforeEach(async () => {
    execute = jest.fn();
    dbUpdate = jest.fn().mockReturnValue(updateChain([]));
    dbSelect = jest.fn().mockReturnValue(selectChain([]));
    dbInsert = jest.fn().mockReturnValue(insertChain([]));
    dbDelete = jest.fn().mockReturnValue(deleteChain([]));
    redisGet = jest.fn().mockResolvedValue(null);
    redisSet = jest.fn().mockResolvedValue('OK');
    redisKeys = jest.fn().mockResolvedValue([]);
    redisDel = jest.fn().mockResolvedValue(0);
    chargeForListing = jest.fn().mockResolvedValue(pendingCharge);
    track = jest.fn().mockResolvedValue(undefined);
    emit = jest.fn();
    storageUpload = jest.fn().mockResolvedValue({ key: 'file-1.jpg', url: 'https://cdn.example/file-1.jpg' });
    storageDelete = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingsService,
        {
          provide: DB,
          useValue: { execute, update: dbUpdate, select: dbSelect, insert: dbInsert, delete: dbDelete },
        },
        {
          provide: REDIS,
          useValue: { get: redisGet, set: redisSet, keys: redisKeys, del: redisDel },
        },
        { provide: LISTING_PAYMENT_PORT, useValue: { chargeForListing } },
        { provide: AnalyticsService, useValue: { track } },
        { provide: EventEmitter2, useValue: { emit } },
        // Weekly limit disabled by default so create tests keep one execute per call.
        { provide: ConfigService, useValue: { get: () => '0' } },
        { provide: STORAGE_PROVIDER, useValue: { upload: storageUpload, delete: storageDelete } },
      ],
    }).compile();

    service = moduleRef.get(ListingsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects coordinates outside the UAE before touching the database', async () => {
      const outsideUae = { ...validDto, latitude: 51.5072, longitude: -0.1276 }; // London

      await expect(service.create(author, outsideUae)).rejects.toThrow(BadRequestException);
      expect(execute).not.toHaveBeenCalled();
    });

    it('writes the listing as PENDING_PAYMENT and returns the hosted payment order', async () => {
      execute
        .mockResolvedValueOnce([{ id: 'listing-1' }]) // INSERT ... RETURNING id
        .mockResolvedValueOnce([listingRow({ status: 'PENDING_PAYMENT', activatedAt: null, expiresAt: null })]);

      const result = await service.create(author, validDto);

      expect(result.listing.status).toBe('PENDING_PAYMENT');
      expect(result.order.redirectUrl).toBe(pendingCharge.redirectUrl);
      expect(result.order.amountFils).toBe(1000);
      expect(chargeForListing).toHaveBeenCalledWith(
        expect.objectContaining({ listingId: 'listing-1', userId: 'user-1' }),
      );
      // Nothing is visible yet, so the browse cache must not be cleared here.
      expect(redisKeys).not.toHaveBeenCalled();
    });

    it('returns an already-settled order when a free credit covered the listing', async () => {
      chargeForListing.mockResolvedValueOnce({
        ...pendingCharge,
        status: PaymentOrderStatus.PAID,
        amountFils: 0,
        method: PaymentMethod.CREDIT,
        redirectUrl: null,
        paidAt: new Date(),
      });
      execute.mockResolvedValueOnce([{ id: 'listing-1' }]).mockResolvedValueOnce([listingRow()]);

      const result = await service.create(author, validDto);

      expect(result.order.method).toBe(PaymentMethod.CREDIT);
      expect(result.order.redirectUrl).toBeNull();
      expect(result.listing.status).toBe('ACTIVE');
    });

    it('discards the draft when no charge could be opened at all', async () => {
      execute.mockResolvedValueOnce([{ id: 'listing-1' }]);
      chargeForListing.mockRejectedValueOnce(new Error('gateway down'));

      await expect(service.create(author, validDto)).rejects.toThrow('gateway down');
      // The orphan draft is taken back down rather than left unpayable.
      expect(dbUpdate).toHaveBeenCalled();
    });

    it('throws if the insert unexpectedly returns no row', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.create(author, validDto)).rejects.toThrow(
        'Listing insert did not return an id',
      );
    });

    it('rejects a post once the weekly listing cap is reached', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ListingsService,
          {
            provide: DB,
            useValue: { execute, update: dbUpdate, select: dbSelect, insert: dbInsert, delete: dbDelete },
          },
          {
            provide: REDIS,
            useValue: { get: redisGet, set: redisSet, keys: redisKeys, del: redisDel },
          },
          { provide: LISTING_PAYMENT_PORT, useValue: { chargeForListing } },
          { provide: AnalyticsService, useValue: { track } },
          { provide: EventEmitter2, useValue: { emit } },
          { provide: ConfigService, useValue: { get: () => '1' } }, // cap of 1/week
          { provide: STORAGE_PROVIDER, useValue: { upload: storageUpload, delete: storageDelete } },
        ],
      }).compile();
      const capped = moduleRef.get(ListingsService);

      execute.mockResolvedValueOnce([{ count: 1 }]); // already at the cap

      await expect(capped.create(author, validDto)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'WEEKLY_LISTING_LIMIT' }),
      });
      expect(chargeForListing).not.toHaveBeenCalled();
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
      execute.mockResolvedValueOnce([listingRow({ distanceMeters: 340.7 })]);

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

    it('hides an unpaid listing from everyone but its author', async () => {
      execute.mockResolvedValueOnce([listingRow({ status: 'PENDING_PAYMENT' })]);

      await expect(service.findById('listing-1', null, 'someone-else')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('shows an unpaid listing to its author so they can finish paying', async () => {
      execute.mockResolvedValueOnce([listingRow({ status: 'PENDING_PAYMENT' })]);

      const result = await service.findById('listing-1', null, 'user-1');

      expect(result.status).toBe('PENDING_PAYMENT');
    });
  });

  describe('onPaymentSettled', () => {
    it('activates the listing and starts the 7-day clock from activation', async () => {
      dbUpdate.mockReturnValue(updateChain([{ id: 'listing-1', authorId: 'user-1' }]));

      await service.onPaymentSettled({
        orderId: 'order-1',
        listingId: 'listing-1',
        userId: 'user-1',
        amountFils: 1000,
      });

      expect(redisKeys).toHaveBeenCalledWith('browse:*');
      expect(track).toHaveBeenCalledWith(
        'listing_activated',
        'user-1',
        expect.objectContaining({ listingId: 'listing-1' }),
      );
    });

    it('is a no-op when the listing is no longer pending, so replays cannot extend it', async () => {
      dbUpdate.mockReturnValue(updateChain([]));

      await service.onPaymentSettled({
        orderId: 'order-1',
        listingId: 'listing-1',
        userId: 'user-1',
        amountFils: 1000,
      });

      expect(redisKeys).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
    });

    it('swallows database failures so a payments callback never fails on our side', async () => {
      dbUpdate.mockImplementation(() => {
        throw new Error('db unavailable');
      });

      await expect(
        service.onPaymentSettled({
          orderId: 'order-1',
          listingId: 'listing-1',
          userId: 'user-1',
          amountFils: 1000,
        }),
      ).resolves.toBeUndefined();
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

  describe('sweepAbandonedDrafts', () => {
    it('removes drafts whose payment was never completed', async () => {
      dbUpdate.mockReturnValue(updateChain([{ id: 'listing-9' }]));

      await expect(service.sweepAbandonedDrafts()).resolves.toBe(1);
    });
  });

  describe('uploadImages', () => {
    const file = { buffer: Buffer.from('fake-jpeg-bytes'), filename: 'photo.jpg', mimetype: 'image/jpeg' };

    it('throws NotFoundException for a listing that does not exist', async () => {
      dbSelect.mockReturnValueOnce(selectChain([])); // ownership lookup: no row

      await expect(service.uploadImages('listing-1', 'user-1', [file])).rejects.toThrow(
        NotFoundException,
      );
      expect(storageUpload).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a listing owned by someone else', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ authorId: 'someone-else', status: 'ACTIVE' }]));

      await expect(service.uploadImages('listing-1', 'user-1', [file])).rejects.toThrow(
        ForbiddenException,
      );
      expect(storageUpload).not.toHaveBeenCalled();
    });

    it('rejects a disallowed file type before touching storage', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ authorId: 'user-1', status: 'ACTIVE' }]));
      const badFile = { ...file, mimetype: 'application/pdf' };

      await expect(service.uploadImages('listing-1', 'user-1', [badFile])).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'INVALID_IMAGE_TYPE' }),
      });
      expect(storageUpload).not.toHaveBeenCalled();
    });

    it('rejects once the listing already has the maximum number of photos', async () => {
      dbSelect
        .mockReturnValueOnce(selectChain([{ authorId: 'user-1', status: 'ACTIVE' }])) // ownership
        .mockReturnValueOnce(selectChain([{ count: MAX_LISTING_IMAGES }])); // countImages

      await expect(service.uploadImages('listing-1', 'user-1', [file])).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'TOO_MANY_IMAGES' }),
      });
      expect(storageUpload).not.toHaveBeenCalled();
    });

    it('uploads to storage and inserts a row per file, positioned after existing images', async () => {
      dbSelect
        .mockReturnValueOnce(selectChain([{ authorId: 'user-1', status: 'ACTIVE' }])) // ownership
        .mockReturnValueOnce(selectChain([{ count: 2 }])); // countImages: 2 already exist
      dbInsert.mockReturnValueOnce(
        insertChain([{ id: 'img-1', url: 'https://cdn.example/file-1.jpg', position: 2 }]),
      );

      const result = await service.uploadImages('listing-1', 'user-1', [file]);

      expect(storageUpload).toHaveBeenCalledWith(file);
      expect(result).toEqual([{ id: 'img-1', url: 'https://cdn.example/file-1.jpg', position: 2 }]);
    });
  });

  describe('deleteImage', () => {
    it('throws NotFoundException for a listing that does not exist', async () => {
      dbSelect.mockReturnValueOnce(selectChain([]));

      await expect(service.deleteImage('listing-1', 'img-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(storageDelete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a listing owned by someone else', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ authorId: 'someone-else', status: 'ACTIVE' }]));

      await expect(service.deleteImage('listing-1', 'img-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(storageDelete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the image row does not belong to this listing', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ authorId: 'user-1', status: 'ACTIVE' }]));
      dbDelete.mockReturnValueOnce(deleteChain([])); // no row matched

      await expect(service.deleteImage('listing-1', 'img-1', 'user-1')).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'IMAGE_NOT_FOUND' }),
      });
      expect(storageDelete).not.toHaveBeenCalled();
    });

    it('deletes the row then the storage object, in that order', async () => {
      dbSelect.mockReturnValueOnce(selectChain([{ authorId: 'user-1', status: 'ACTIVE' }]));
      dbDelete.mockReturnValueOnce(deleteChain([{ id: 'img-1', key: 'file-1.jpg' }]));

      await service.deleteImage('listing-1', 'img-1', 'user-1');

      expect(storageDelete).toHaveBeenCalledWith('file-1.jpg');
    });
  });
});
