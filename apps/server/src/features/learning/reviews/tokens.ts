import { createHash, randomBytes } from 'node:crypto';

// Review link tokens (decision 0309): 32 random bytes, written as 43 base64url characters, shown once in the
// link and stored only as their SHA-256.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new token for a review link. */
export const newReviewToken = (): string => randomBytes(32).toString('base64url');

/** What the database keeps of a token: its SHA-256, in hex. */
export const hashReviewToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** Whether a header value has a token's shape, checked before any lookup. */
export const isReviewToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_PATTERN.test(value);
