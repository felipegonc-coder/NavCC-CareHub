import type { Image, MediaRef } from '../format/index';

/** Makes a fixture read-only all the way down, so tests can't change it by accident (copy it first). */
export function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

/** A fake Care Hub file id; fixtures never point at real files. */
export const file = (fileId: string): MediaRef => ({ kind: 'file', fileId });

export const picture = (fileId: string, alt: string, caption?: string): Image =>
  caption === undefined ? { media: file(fileId), alt } : { media: file(fileId), alt, caption };
