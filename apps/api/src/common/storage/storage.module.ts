import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from './storage-provider.interface';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';

@Module({
  providers: [
    LocalDiskStorageProvider,
    S3StorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, LocalDiskStorageProvider, S3StorageProvider],
      useFactory: (config: ConfigService, local: LocalDiskStorageProvider, s3: S3StorageProvider) =>
        config.getOrThrow<string>('STORAGE_PROVIDER') === 's3' ? s3 : local,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
