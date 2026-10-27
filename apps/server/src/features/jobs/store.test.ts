import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, expect, it } from 'vitest';
import { createJobRunner } from './domain/runner';
import { describeJobStoreContract } from './domain/storeContract';
import { sqlRunnerFor, type SqlExecutor } from './sql';
import { createPostgresJobStore, type SqlRunner } from './store';

interface PgClient extends SqlRunner {
  connect(): Promise<void>;
  end(): Promise<void>;
}
type PgModule = { Client: new (config: { connectionString: string }) => PgClient };
interface DrizzleDb extends SqlExecutor {
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
type DrizzleModule = { drizzle: (client: PgClient) => DrizzleDb };

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

/** A client on `schema`, or on a fresh schema made with the real migrations. */
async function connect(schema?: string): Promise<{ client: PgClient; schema: string }> {
  if (!pg) throw new Error('pg is missing');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const name = schema ?? `jobs_test_${randomUUID().replaceAll('-', '')}`;
  opened.push({ client, schema: name });
  if (!schema) await client.query(`CREATE SCHEMA ${name}`);
  await client.query(`SET search_path TO ${name}`);
  if (schema) return { client, schema: name };
  // Every jobs migration, in order.
  const folder = new URL('../../../migrations/', import.meta.url);
  const files = (await readdir(folder)).filter((file) => /^\d{12}_jobs_.*\.sql$/.test(file));
  for (const file of files.sort()) {
    await client.query(await readFile(new URL(file, folder), 'utf8'));
  }
  return { client, schema: name };
}

// Straight on a node-postgres client, and through Drizzle as on `app.db`.
const drivers = pg ? (drizzle ? (['pg', 'drizzle'] as const) : (['pg'] as const)) : [];

for (const driver of drivers) {
  describeJobStoreContract(`postgres store (${driver})`, async () => {
    const { client } = await connect();
    return createPostgresJobStore(
      driver === 'drizzle' && drizzle ? sqlRunnerFor(drizzle.drizzle(client)) : client,
    );
  });
}
if (drivers.length === 0) {
  it.skip('postgres store contract (needs DATABASE_URL and pg)', () => {});
} else {
  it('queues a job through a caller’s transaction, only if it commits', async () => {
    const { client, schema } = await connect();
    const other = (await connect(schema)).client;
    const runner = createJobRunner({ store: createPostgresJobStore(client) });
    const queue = (key: string, sql: SqlRunner) =>
      runner.schedule({ kind: 'reminders.fire', payload: {}, key }, { sql });

    await other.query('BEGIN');
    const kept = await queue('kept', other);
    expect(await runner.get(kept.jobId)).toBeNull();
    await other.query('COMMIT');
    expect(await runner.get(kept.jobId)).toMatchObject({ key: 'kept', status: 'queued' });

    await other.query('BEGIN');
    const dropped = await queue('dropped', other);
    await other.query('ROLLBACK');
    expect(await runner.get(dropped.jobId)).toBeNull();

    if (!drizzle) return;
    // As features do it: scheduleJob(input, { db: tx }) inside app.db.transaction().
    const db = drizzle.drizzle(other);
    let jobId = '';
    const rolledBack = db.transaction(async (tx) => {
      jobId = (await queue('drizzle', sqlRunnerFor(tx))).jobId;
      throw new Error('Roll back.');
    });
    await expect(rolledBack).rejects.toThrow('Roll back.');
    expect(await runner.get(jobId)).toBeNull();
    await db.transaction(async (tx) => {
      jobId = (await queue('drizzle', sqlRunnerFor(tx))).jobId;
    });
    expect(await runner.get(jobId)).toMatchObject({ key: 'drizzle', status: 'queued' });
  });
}
