'use client';

import { useRef, useState } from 'react';
import type { ListingImage } from '@hl/shared';
import { ALLOWED_IMAGE_MIMETYPES, MAX_LISTING_IMAGES } from '@hl/shared';
import { ApiError } from '@/lib/api-client';
import { deleteListingImage, uploadListingImages } from '@/lib/listings-client';

interface Props {
  listingId: string;
  accessToken: string;
  images: ListingImage[];
  onChange: (images: ListingImage[]) => void;
}

/** Owner-only photo management, embedded in each dashboard listing card. */
export function ListingImagesEditor({ listingId, accessToken, images, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // lets picking the same file again re-fire onChange
    if (files.length === 0) return;

    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadListingImages(listingId, accessToken, files);
      onChange([...images, ...uploaded].sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload your photos.');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(imageId: string) {
    setError(null);
    setBusy(true);
    try {
      await deleteListingImage(listingId, imageId, accessToken);
      onChange(images.filter((img) => img.id !== imageId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that photo.');
    } finally {
      setBusy(false);
    }
  }

  const atLimit = images.length >= MAX_LISTING_IMAGES;

  return (
    <div className="mt-4 border-t border-line pt-4">
      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- photo URLs come from S3/local dev storage, not a domain Next's image optimizer is configured for */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => void onDelete(img.id)}
                disabled={busy}
                aria-label="Remove photo"
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-xs text-canvas disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <input
        ref={fileInput}
        type="file"
        accept={ALLOWED_IMAGE_MIMETYPES.join(',')}
        multiple
        className="hidden"
        onChange={(e) => void onFilesSelected(e)}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy || atLimit}
        className="rounded-card border border-line px-4 py-2 text-xs font-semibold text-slate disabled:opacity-50"
      >
        {busy ? 'Working…' : atLimit ? `Max ${MAX_LISTING_IMAGES} photos` : 'Add photos'}
      </button>
    </div>
  );
}
