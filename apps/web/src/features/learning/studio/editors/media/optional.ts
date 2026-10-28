import { isBlankRichText, type RichText } from '@carehub/learning';

/** A copy of `item` with `key` set, or without it when `value` is undefined (optional fields stay out). */
export function withOptional<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined,
): T {
  const next = { ...item };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** Optional rich text left blank is stored as nothing. */
export const optionalRichText = (value: RichText): RichText | undefined =>
  isBlankRichText(value) ? undefined : value;
