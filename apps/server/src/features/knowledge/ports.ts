// What the knowledge base needs from the page model (#49) and the Databases lane's api.ts (W2-2).
// Neither is on main yet, so these are stand-ins that deny by default: until they're bound, no
// page is in a knowledge base, nobody can open anything and nothing is written. Tests bind fakes.
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../db';
import { httpError } from '../../core/errors';

type Executor = Db | Tx;

/** A wiki database (a knowledge base). */
export interface WikiBase {
  id: string;
  workspaceId: string;
  title: string;
}

/** A page in a knowledge base: a row of its wiki database, with every value (no access check). */
export interface WikiRow {
  id: string;
  databaseId: string;
  workspaceId: string;
  title: string;
  createdBy: string | null;
  values: Record<string, unknown>;
  /** The Tags options it has, in order. */
  tags: { id: string; name: string; color: string }[];
}

export interface KnowledgePorts {
  // stand-in: getAccessForPages(db, userId, pageIds) from features/pages (#49). With the row
  // limiter registered, drafts already come back as 'none' for readers.
  accessForPages(
    db: Executor,
    userId: string,
    pageIds: string[],
  ): Promise<Map<string, AccessLevel>>;
  // stand-in: the database's meta from features/databases/api.ts (W2-2), null unless `wiki`.
  getBase(db: Executor, databaseId: string): Promise<WikiBase | null>;
  // stand-in: a system read of one row from features/databases/api.ts, null unless in a wiki.
  getRow(db: Executor, rowId: string): Promise<WikiRow | null>;
  // stand-in: updateRows(tx, { databaseId, rowIds, values, actorUserId, source: 'knowledge' })
  // from features/databases/api.ts, which lets the knowledge base write its built-in properties.
  writeValues(
    tx: Tx,
    input: {
      databaseId: string;
      rowId: string;
      values: Record<string, unknown>;
      by: string | null;
    },
  ): Promise<void>;
  // stand-in: archivePage(tx, pageId, by) from features/pages (pages PR 2).
  archivePage(tx: Tx, pageId: string, by: string): Promise<void>;
  // stand-in: the people with at least `min` on a page, from features/pages (#49): reports on a
  // page without an owner go to the knowledge base's Full access people.
  usersWithAccess(db: Executor, pageId: string, min: AccessLevel): Promise<string[]>;
}

const unavailable = () => httpError(409, 'conflict', "Knowledge bases aren't available yet.");

const denyAll: KnowledgePorts = {
  accessForPages: async (_db, _userId, pageIds) => new Map(pageIds.map((id) => [id, 'none'])),
  getBase: async () => null,
  getRow: async () => null,
  writeValues: async () => {
    throw unavailable();
  },
  archivePage: async () => {
    throw unavailable();
  },
  usersWithAccess: async () => [],
};

let ports: KnowledgePorts = denyAll;

/** Binds real or fake ports (any not given keep denying); the returned function unbinds them. */
export function bindKnowledgePorts(next: Partial<KnowledgePorts>): () => void {
  const bound = { ...denyAll, ...next };
  ports = bound;
  return () => {
    if (ports === bound) ports = denyAll;
  };
}

export const kbPorts = (): KnowledgePorts => ports;

type RowLimiter = (input: {
  databaseId: string;
  row: { id: string; values: Record<string, unknown>; createdBy: string | null };
  properties: unknown;
  userId: string | null;
  level: AccessLevel;
}) => AccessLevel;

const limiters = new Map<string, RowLimiter>();

// stand-in: registerRowAccessLimiter(kind, limiter) from features/databases/api.ts (decision
// 0200), which applies it to rows of databases with that flag. Kept here until then.
export function registerRowAccessLimiter(kind: string, limiter: RowLimiter): void {
  limiters.set(kind, limiter);
}

export const rowAccessLimiter = (kind: string) => limiters.get(kind);
