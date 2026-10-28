import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAutomationStore } from '../domain/memoryStore';
import type { AutomationStore } from '../domain/types';
import { createPostgresAutomationStore, type SqlRunner } from '../store';
import { createMemoryDateChecks, createPostgresDateChecks, type DateChecks } from './dateChecks';

interface PgClient extends SqlRunner {
  connect(): Promise<void>;
  end(): Promise<void>;
}
type PgModule = { Client: new (config: { connectionString: string }) => PgClient };

const url = process.env.DATABASE_URL ?? '';
const workspaceId = randomUUID();
const now = new Date('2026-10-28T15:00:00Z');
const at = (iso: string) => new Date(iso);

interface Made {
  checks: DateChecks;
  store: AutomationStore;
}

/** The times as [id, ISO] pairs, in the order asked. */
async function loaded(checks: DateChecks, ids: string[]) {
  const found = await checks.load(ids);
  return ids.flatMap((id) => {
    const until = found.get(id);
    return until ? [[id, until.toISOString()]] : [];
  });
}

async function automationsIn(store: AutomationStore): Promise<string[]> {
  const ids: string[] = [];
  for (const name of ['Review reminder', 'Follow-up reminder']) {
    const automation = await store.create(
      {
        workspaceId,
        name,
        ownerUserId: randomUUID(),
        enabled: true,
        trigger: {
          kind: 'dateArrives',
          databaseId: randomUUID(),
          propertyId: 'review-date',
          offset: null,
          time: '09:00',
          timeZone: 'America/Denver',
        },
        conditions: null,
        variables: [],
        actions: [
          { kind: 'sendMessage', recipients: [{ kind: 'everyone' }], text: 'Hi', pageIds: [] },
        ],
        nextRunAt: null,
      },
      now,
    );
    if (!automation) throw new Error('not created');
    ids.push(automation.id);
  }
  return ids;
}

function describeDateChecks(
  name: string,
  make: () => Promise<Made>,
  more?: (made: () => Made & { ids: string[] }) => void,
) {
  describe(name, () => {
    let made: Made & { ids: string[] };
    beforeEach(async () => {
      const { checks, store } = await make();
      made = { checks, store, ids: await automationsIn(store) };
    });

    it('keeps the time each automation was checked up to', async () => {
      const { checks, ids } = made;
      const [review = '', followUp = ''] = ids;
      expect(await loaded(checks, ids)).toEqual([]);
      await checks.save(review, at('2026-10-28T15:00:00Z'));
      await checks.save(review, at('2026-10-28T15:00:30Z'));
      await checks.save(followUp, at('2026-10-28T15:00:31Z'));
      expect(await loaded(checks, ids)).toEqual([
        [review, '2026-10-28T15:00:30.000Z'],
        [followUp, '2026-10-28T15:00:31.000Z'],
      ]);
      expect((await checks.load([])).size).toBe(0);
    });

    it('forgets the automations it is not told to keep', async () => {
      const { checks, ids } = made;
      const [review = '', followUp = ''] = ids;
      await checks.save(review, now);
      await checks.save(followUp, now);
      await checks.keepOnly([followUp]);
      expect(await loaded(checks, ids)).toEqual([[followUp, now.toISOString()]]);
      await checks.keepOnly([]);
      expect(await loaded(checks, ids)).toEqual([]);
    });

    more?.(() => made);
  });
}

describeDateChecks('memory date checks', async () => ({
  checks: createMemoryDateChecks(),
  store: createMemoryAutomationStore(),
}));

/** These run where Postgres is (DATABASE_URL is set) and the driver is installed. */
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

if (pg) {
  describeDateChecks(
    'postgres date checks',
    async () => {
      // A fresh schema per test, made with the real migrations.
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      const schema = `automations_dates_${randomUUID().replaceAll('-', '')}`;
      opened.push({ client, schema });
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      const folder = new URL('../../../../migrations/', import.meta.url);
      const files = (await readdir(folder)).filter((file) =>
        /^\d{12}_automations_.*\.sql$/.test(file),
      );
      for (const file of files.sort()) {
        await client.query(await readFile(new URL(file, folder), 'utf8'));
      }
      return {
        checks: createPostgresDateChecks(client),
        store: createPostgresAutomationStore(client),
      };
    },
    (made) => {
      it('goes with its automation, and saves nothing for one that is gone', async () => {
        const { checks, store, ids } = made();
        const [review = ''] = ids;
        await checks.save(review, now);
        expect(await store.remove(workspaceId, review)).toBe(true);
        expect(await loaded(checks, [review])).toEqual([]);
        await checks.save(review, now);
        expect(await loaded(checks, [review])).toEqual([]);
      });
    },
  );
} else {
  it.skip('postgres date checks (needs DATABASE_URL and pg)', () => {});
}
