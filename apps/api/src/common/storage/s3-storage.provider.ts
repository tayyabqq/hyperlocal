import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageProvider, StoredFile, UploadedObject } from './storage-provider.interface';

const EXTENSION_BY_MIMETYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Production storage. No access keys here by design — the AWS SDK's default
 * credential chain picks up the ECS task's IAM role, so nothing is ever
 * hardcoded or passed through env vars (see docs/DEPLOYMENT.md).
 *
 * Config is read lazily (on first use), not in the constructor: this provider
 * is always instantiated by StorageModule alongside LocalDiskStorageProvider
 * regardless of which one STORAGE_PROVIDER actually selects, so an eager
 * `getOrThrow('S3_REGION')` would crash boot in local dev, which never sets
 * it. Same pattern PayTabsGateway uses for the same reason.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private client: S3Client | undefined;
  private bucket = '';
  private publicBaseUrl = '';

  constructor(private readonly config: ConfigService) {}

  async upload(file: StoredFile): Promise<UploadedObject> {
    this.ensureConfigured();
    const ext = EXTENSION_BY_MIMETYPE[file.mimetype] ?? 'bin';
    const key = `listings/${randomUUID()}.${ext}`;
    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return { key, url: `${this.publicBaseUrl}/${key}` };
  }

  async delete(key: string): Promise<void> {
    this.ensureConfigured();
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private ensureConfigured(): void {
    if (this.client) return;
    const region = this.config.getOrThrow<string>('S3_REGION');
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.client = new S3Client({ region });
    // A CDN in front of the bucket if configured, otherwise the bucket's own
    // regional endpoint.
    this.publicBaseUrl =
      this.config.get<string>('S3_PUBLIC_BASE_URL') ??
      `https://${this.bucket}.s3.${region}.amazonaws.com`;
  }
}
