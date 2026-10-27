import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, it } from 'vitest';
import { describeJobStoreContract } from './domain/storeContract';
import { sqlRunnerFor, type SqlExecutor } from './sql';
import { createPostgresJobStore, type SqlRunner } from './store';

interface PgClient extends SqlRunner {
  connect(): Promise<void>;
  end(): Promise<void>;
}
type PgModule = { Client: new (config: { connectionString: string }) => PgClient };
type DrizzleModule = { drizzle: (client: PgClient) => SqlExecutor };

const url = process.env.DATABASE_URL ?? '';

/** These tests run where Postgres is (DATABASE_URL is set) and the drivers are installed. */
function load<T>(name: string): T | null {
  if (!url) return null;
  try {
    return createRequire(import.meta.url)(name) as T;
  } catch {
    return null;
  }
}

const pg = load<PgModule>('pg');
const drizzle = load<DrizzleModule>('drizzle-orm/node-postgres');
const opened: { client: PgClient; schema: string }[] = [];

afterAll(async () => {
  for (const { client, schema } of opened) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});

// Straight on a node-postgres client, and through Drizzle as on `app.db`.
const drivers = pg ? (drizzle ? (['pg', 'drizzle'] as const) : (['pg'] as const)) : [];

for (const driver of drivers) {
  describeJobStoreContract(`postgres store (${driver})`, async () => {
    if (!pg) throw new Error('pg is missing');
    // A fresh schema per test, made with the real migration.
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const schema = `jobs_test_${randomUUID().replaceAll('-', '')}`;
    opened.push({ client, schema });
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    // Every jobs migration, in order.
    const folder = new URL('../../../migrations/', import.meta.url);
    const files = (await readdir(folder)).filter((name) => /^\d{12}_jobs_.*\.sql$/.test(name));
    for (const name of files.sort()) {
      await client.query(await readFile(new URL(name, folder), 'utf8'));
    }
    return createPostgresJobStore(
      driver === 'drizzle' && drizzle ? sqlRunnerFor(drizzle.drizzle(client)) : client,
    );
  });
}
if (drivers.length === 0) {
  it.skip('postgres store contract (needs DATABASE_URL and pg)', () => {});
}
