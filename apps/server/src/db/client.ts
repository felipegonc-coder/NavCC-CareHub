import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

/** The Drizzle database (`app.db`). A transaction (`Tx`) works wherever a `Db` does. */
export type Db = PgDatabase<NodePgQueryResultHKT>;
/** A transaction: `db.transaction(async (tx) => { ... })`. Service functions take `Db | Tx` first. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DatabaseConnection {
  db: Db;
  pool: pg.Pool;
  /** Closes the pool. Safe to call more than once. */
  close: () => Promise<void>;
}

export function createDatabase(
  databaseUrl: string,
  onError?: (error: Error) => void,
): DatabaseConnection {
  // Without a connect timeout, an unreachable database host holds every request for minutes; this way they
  // fail after 5 s, and public routes such as GET /api/status can still answer (see the auth plugin).
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  // An idle connection can fail (for example when Postgres restarts). Without a listener that would crash the process.
  pool.on('error', (error) => onError?.(error));
  let closing: Promise<void> | undefined;
  return { db: drizzle(pool), pool, close: () => (closing ??= pool.end()) };
}
