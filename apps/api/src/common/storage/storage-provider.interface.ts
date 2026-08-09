export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StoredFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface UploadedObject {
  /** Provider-specific identifier needed to delete the object later. */
  key: string;
  /** Publicly reachable URL for the object. */
  url: string;
}

/**
 * Swappable image storage, same pattern as the payment gateway and OTP/push
 * providers: an interface, a local dev-only implementation, and a real cloud
 * implementation selected by env config.
 */
export interface StorageProvider {
  upload(file: StoredFile): Promise<UploadedObject>;
  delete(key: string): Promise<void>;
}
