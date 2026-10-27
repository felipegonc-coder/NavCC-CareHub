import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, it } from 'vitest';
import { describeJobStoreContract } from './domain/storeContract';
import { createPostgresJobStore, type SqlRunner } from './store';

interface PgClient extends SqlRunner {
  connect(): Promise<void>;
  end(): Promise<void>;
}
type PgModule = { Client: new (config: { connectionString: string }) => PgClient };

const url = process.env.DATABASE_URL;

/** `pg` isn't a dependency yet: these tests run where it's installed and DATABASE_URL is set. */
function loadPg(): PgModule | null {
  if (!url) return null;
  try {
    return createRequire(import.meta.url)('pg') as PgModule;
  } catch {
    return null;
  }
}

const pg = loadPg();
const opened: { client: PgClient; schema: string }[] = [];

afterAll(async () => {
  for (const { client, schema } of opened) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});

if (url && pg) {
  describeJobStoreContract('postgres store', async () => {
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
    return createPostgresJobStore(client);
  });
} else {
  it.skip('postgres store contract (needs DATABASE_URL and pg)', () => {});
}
