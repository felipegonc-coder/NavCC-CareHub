import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATION_NAME = /^\d{12}_[a-z0-9-]+_[a-z0-9_-]+\.sql$/;
/** Key for pg_advisory_lock, so two processes (or parallel test files) never migrate at the same time. */
const MIGRATION_LOCK_KEY = 4_812_260_101;

/** apps/server/migrations, found from src/db/ (tests, tsx) or from the bundled dist/ files. */
export function defaultMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../migrations'), path.resolve(here, '../../migrations')];
  return candidates.find((dir) => existsSync(dir)) ?? path.resolve(here, '../../migrations');
}

export async function listMigrations(dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql'));
  const badNames = files.filter((name) => !MIGRATION_NAME.test(name));
  if (badNames.length > 0) {
    throw new Error(
      `Migration files must be named YYYYMMDDHHMM_<feature>_<what>.sql: ${badNames.join(', ')}`,
    );
  }
  return files.sort();
}

/**
 * Applies every .sql file in `dir` that hasn't run yet (even one whose name sorts before files already
 * applied), in name order, each in its own transaction, and records it in schema_migrations. Returns the names applied now. Files must not contain
 * BEGIN/COMMIT or statements that can't run in a transaction (such as CREATE INDEX CONCURRENTLY).
 */
export async function runMigrations(
  pool: pg.Pool,
  options: { dir?: string | undefined; log?: (message: string) => void } = {},
): Promise<string[]> {
  const dir = options.dir ?? defaultMigrationsDir();
  const files = await listMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
      const done = new Set(rows.map((row) => row.name));
      const applied: string[] = [];
      for (const file of files.filter((name) => !done.has(name))) {
        const sql = await readFile(path.join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Migration ${file} failed: ${reason}`, { cause: error });
        }
        applied.push(file);
        options.log?.(`Applied migration ${file}`);
      }
      return applied;
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
