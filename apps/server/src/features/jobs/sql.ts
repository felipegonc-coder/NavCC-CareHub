import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SqlRunner } from './store';

/** What `sqlRunnerFor` needs from `app.db` (Drizzle) or one of its transactions. */
export interface SqlExecutor {
  execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
}

/**
 * Plain SQL with `$1`-style parameters on the app's database or a transaction, so a store written
 * for a node-postgres pool works on `app.db` too. Each `$n` becomes a bound parameter.
 */
export function sqlRunnerFor(db: SqlExecutor): SqlRunner {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const chunks = text
        .split(/\$(\d+)/)
        .map((part, i) => (i % 2 === 0 ? sql.raw(part) : sql.param(params[Number(part) - 1])));
      const { rows } = await db.execute(sql.join(chunks));
      return { rows: rows as T[] };
    },
  };
}
