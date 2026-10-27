import { isHttpsUrl, type MediaRef } from '@carehub/learning';

/** Where course files are served from: core's files API (decision 0007 section 4.3). */
export const FILES_URL = '/api/files';

/**
 * The address to show or play media from: Care Hub's address for an uploaded file, or the link (https only).
 * Pictures and media files from other sites don't load in Care Hub (its Content-Security-Policy), so links are
 * copied into course files when they are added (`uploadFromUrl`).
 */
export function mediaUrl(ref: MediaRef | undefined): string | undefined {
  if (!ref) return undefined;
  if (ref.kind === 'file') return `${FILES_URL}/${encodeURIComponent(ref.fileId)}`;
  return isHttpsUrl(ref.url) ? ref.url : undefined;
}

/**
 * The address of a picture, video, audio or captions file, for `src`. A hook so screens stay the same if files
 * later need signed or expiring addresses.
 */
export function useMediaUrl(ref: MediaRef | undefined): string | undefined {
  return mediaUrl(ref);
}
