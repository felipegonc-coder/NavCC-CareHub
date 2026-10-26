// Small helpers shared by the workspaces and pages features.
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ROLE_PERMISSIONS, type Permission } from '@carehub/shared';

export type Db = FastifyInstance['db'];
/** The database or an open transaction. */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = "You don't have permission to do that.") =>
  new HttpError(403, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Validates input with zod; problems become a 400 that names the field. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ` : '') + issue.message,
  );
  throw badRequest(problems.join('; '));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** The `:id` route parameter. Something that isn't an ID can't exist, so it's a 404. */
export function idParam(request: FastifyRequest, what: string): string {
  const { id } = request.params as { id?: unknown };
  if (!isUuid(id)) throw notFound(`${what} not found.`);
  return id;
}

export type Actor = { userId: string; workspaceId: string };

/** The signed-in person and their current workspace (set by the accounts feature). */
export function actorOf(request: FastifyRequest): Actor {
  const user = request.user;
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return { userId: user.id, workspaceId: user.workspaceId };
}

/** Whether a workspace role includes a permission (role map in @carehub/shared). */
export const can = (role: string, permission: Permission): boolean =>
  (ROLE_PERMISSIONS as Record<string, readonly string[] | undefined>)[role]?.includes(permission) ??
  false;
export const isAdminRole = (role: string): boolean => role === 'admin';

/** A uuid[] literal for `= ANY(...)`; safe when empty. */
export const uuidArray = (ids: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;

export function first<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined) throw notFound();
  return row;
}
