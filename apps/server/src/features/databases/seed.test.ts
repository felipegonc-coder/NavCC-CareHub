// The databases seed on a real database (decision 0007 section 2.5): Blue Pine Plumbing's jobs at
// the top of the team space, added once however often the seed runs. Fictional people only.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedContext } from '../../seed';
import { hasDatabase } from '../../testing';
import { seed } from './seed';
import { SEED_TITLE } from './seed-data';
import { testWorkspace, type TestWorkspace } from './test-workspace';

describe.skipIf(!hasDatabase)('the databases seed', () => {
  let ws: TestWorkspace;

  beforeAll(async () => {
    ws = await testWorkspace();
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('adds the jobs at the top of the team space once, however often it runs', async () => {
    const admin = await ws.person('admin', 'Morgan Reyes');
    const ctx: SeedContext = {
      db: ws.db,
      workspaceId: ws.workspaceId,
      users: {
        admin,
        editor: await ws.person('editor', 'Avery Lin'),
        commenter: await ws.person('viewer', 'Sam Ortiz'),
        viewer: await ws.person('viewer', 'Jordan Park'),
      },
      teamSpaceId: ws.spaceId,
      log: ws.app.log,
      createRole: async () => {
        throw new Error('The databases seed adds no roles.');
      },
      createPerson: async () => {
        throw new Error('The databases seed adds no people.');
      },
    };
    await seed(ctx);
    await seed(ctx);

    const { rows } = await ws.db.execute<{ id: string; parent_id: string | null; kind: string }>(
      sql`SELECT p.id, p.parent_id, p.kind FROM db_databases d JOIN pages p ON p.id = d.page_id
        WHERE d.workspace_id = ${ws.workspaceId} AND p.title = ${SEED_TITLE}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parent_id: null, kind: 'database' });
    const id = rows[0]!.id;
    const meta = (await ws.send(admin, 'GET', `/api/databases/${id}`)).json();
    expect(meta.views.map((v: { name: string }) => v.name)).toEqual([
      'All jobs',
      'By status',
      'Visits',
      'Request a visit',
    ]);
    const jobs = await ws.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM db_rows WHERE database_id = ${id}`,
    );
    expect(jobs.rows[0]?.n).toBe(4);
  });
});
