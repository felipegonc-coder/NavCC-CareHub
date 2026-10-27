// Small helpers for the page model's routes and queries. Errors use core/errors.ts (decision 0007,
// section 2.2): 403 and 404 keep their standard messages, so they never name a page.
import { sql, type SQL } from 'drizzle-orm';
import { httpError } from '../../core/errors';

export const invalid = (message: string) => httpError(400, 'invalid', message);
export const forbidden = () => httpError(403, 'forbidden');
export const notFound = () => httpError(404, 'not_found');
export const conflict = (message: string) => httpError(409, 'conflict', message);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** A uuid[] for `= ANY(...)`; fine when empty. */
export const uuidArray = (ids: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
