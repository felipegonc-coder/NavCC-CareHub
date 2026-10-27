import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../features/auth/schema';
import { createTestDatabase, hasDatabase } from '../testing';
import { defaultMigrationsDir, listMigrations, runMigrations } from './migrate';

async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'carehub-migrations-'));
  await Promise.all(
    Object.entries(files).map(([name, sql]) => writeFile(path.join(dir, name), sql)),
  );
  return dir;
}

describe('listMigrations', () => {
  it('lists .sql files in name order', async () => {
    const dir = await migrationsDir({
      '202601020000_test_second.sql': 'SELECT 1;',
      '202601010000_test_first.sql': 'SELECT 1;',
      'README.md': 'Not a migration.',
    });
    expect(await listMigrations(dir)).toEqual([
      '202601010000_test_first.sql',
      '202601020000_test_second.sql',
    ]);
  });

  it('rejects files that are not named YYYYMMDDHHMM_<feature>_<what>.sql', async () => {
    const dir = await migrationsDir({
      '202601010000_test_first.sql': 'SELECT 1;',
      'add_users.sql': 'SELECT 1;',
    });
    await expect(listMigrations(dir)).rejects.toThrow(/add_users\.sql/);
  });

  it('finds the real migrations', async () => {
    expect(await listMigrations(defaultMigrationsDir())).toContain(
      '202610262300_auth_accounts.sql',
    );
  });
});

describe.skipIf(!hasDatabase)('runMigrations', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function emptyDatabase(): Promise<pg.Pool> {
    const database = await createTestDatabase();
    const pool = new pg.Pool({ connectionString: database.url, max: 4 });
    cleanups.push(async () => {
      await pool.end();
      await database.drop();
    });
    return pool;
  }

  const appliedNames = async (pool: pg.Pool) =>
    (
      await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
    ).rows.map((row) => row.name);

  it('applies new files in name order, each once', async () => {
    const pool = await emptyDatabase();
    const dir = await migrationsDir({
      '202601010100_test_add_note.sql': "INSERT INTO notes (body) VALUES ('Fictional note');",
      '202601010000_test_create_notes.sql':
        'CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL);',
    });
    const names = ['202601010000_test_create_notes.sql', '202601010100_test_add_note.sql'];
    expect(await runMigrations(pool, { dir })).toEqual(names);
    expect(await runMigrations(pool, { dir })).toEqual([]);
    expect(await appliedNames(pool)).toEqual(names);
    expect((await pool.query('SELECT body FROM notes')).rows).toEqual([{ body: 'Fictional note' }]);
  });

  it('also applies a new file whose name sorts before files already applied', async () => {
    const pool = await emptyDatabase();
    const later = { '202601020000_test_create_notes.sql': 'CREATE TABLE notes (id int);' };
    expect(await runMigrations(pool, { dir: await migrationsDir(later) })).toHaveLength(1);
    // Merged later from a branch that was started earlier.
    const dir = await migrationsDir({
      ...later,
      '202601010000_test_create_tags.sql': 'CREATE TABLE tags (id int);',
    });
    expect(await runMigrations(pool, { dir })).toEqual(['202601010000_test_create_tags.sql']);
    expect(await appliedNames(pool)).toEqual([
      '202601010000_test_create_tags.sql',
      '202601020000_test_create_notes.sql',
    ]);
  });

  it('rolls back a failing file and names it', async () => {
    const pool = await emptyDatabase();
    const dir = await migrationsDir({
      '202601010000_test_create_notes.sql': 'CREATE TABLE notes (id serial PRIMARY KEY);',
      '202601010100_test_broken.sql':
        'CREATE TABLE more_notes (id int); SELECT * FROM table_that_does_not_exist;',
    });
    await expect(runMigrations(pool, { dir })).rejects.toThrow(/202601010100_test_broken\.sql/);
    const { rows } = await pool.query("SELECT to_regclass('more_notes') AS found");
    expect(rows).toEqual([{ found: null }]);
    expect(await appliedNames(pool)).toEqual(['202601010000_test_create_notes.sql']);
  });

  it('applies each file once when several servers start at the same time', async () => {
    const pool = await emptyDatabase();
    const dir = await migrationsDir({
      '202601010000_test_create_notes.sql': 'CREATE TABLE notes (id serial PRIMARY KEY);',
    });
    const results = await Promise.all([1, 2, 3].map(() => runMigrations(pool, { dir })));
    expect(results.flat()).toEqual(['202601010000_test_create_notes.sql']);
  });

  it('creates the account tables exactly as the Drizzle definitions describe them', async () => {
    const pool = await emptyDatabase();
    expect(await runMigrations(pool)).toContain('202610262300_auth_accounts.sql');
    for (const table of [users, sessions]) {
      const config = getTableConfig(table);
      const { rows } = await pool.query<{
        name: string;
        type: string;
        not_null: boolean;
        has_default: boolean;
      }>(
        `SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
                attnotnull AS not_null, atthasdef AS has_default
         FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped`,
        [config.name],
      );
      const inDatabase = Object.fromEntries(
        rows.map((row) => [
          row.name,
          { type: row.type, notNull: row.not_null, hasDefault: row.has_default },
        ]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
        ]),
      );
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });
});
