import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageProvider, StoredFile, UploadedObject } from './storage-provider.interface';

const EXTENSION_BY_MIMETYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Dev-only: writes to a local directory served back out under /uploads (see
 * main.ts). Never permitted in production — see env.validation.ts — because
 * ECS task storage is ephemeral and not shared across instances.
 */
@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalDiskStorageProvider.name);
  private readonly dir: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.dir = join(process.cwd(), 'uploads');
    this.publicBaseUrl = this.config.getOrThrow<string>('API_PUBLIC_URL');
  }

  async upload(file: StoredFile): Promise<UploadedObject> {
    await mkdir(this.dir, { recursive: true });
    const ext = EXTENSION_BY_MIMETYPE[file.mimetype] ?? 'bin';
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(this.dir, key), file.buffer);
    return { key, url: `${this.publicBaseUrl}/uploads/${key}` };
  }

  async delete(key: string): Promise<void> {
    await unlink(join(this.dir, key)).catch((error: unknown) => {
      this.logger.warn(`Could not delete local upload ${key}: ${String(error)}`);
    });
  }
}
