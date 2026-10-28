// The fixed errors the database routes answer with (decision 0200; shapes in core/errors.ts).
import { INVALID_REQUEST_MESSAGE } from '@carehub/databases/schemas';
import { httpError } from '../../core/errors';

/** Messages, word for word. */
export const DATABASE_MESSAGES = {
  changed: 'This database changed. Reload to see the latest.',
  locked: 'This database is locked. Unlock it to change its structure.',
  tooManyProperties: 'A database can have up to 200 properties.',
} as const;

/** 400 for a body the schemas refuse (never repeats what was sent). */
export const invalidRequest = () => httpError(400, 'invalid', INVALID_REQUEST_MESSAGE);
/** 400 with one of the fixed messages. */
export const invalid = (message: string) => httpError(400, 'invalid', message);
export const forbidden = (message?: string) => httpError(403, 'forbidden', message);
export const notFound = () => httpError(404, 'not_found');
/** 409: someone else saved the database's settings since this version. */
export const changed = () => httpError(409, 'conflict', DATABASE_MESSAGES.changed);
