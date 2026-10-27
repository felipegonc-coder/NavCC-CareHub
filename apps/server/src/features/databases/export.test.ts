// CSV export (decision 0200; spec 3.8; W2-4): POST /:id/export for This view and Everything, the
// job's file in db_exports, and the download: only the person who asked, for 24 hours, with a
// clean file name. The file holds exactly what the query shows that person: only rows they can
// open, no column for a property they can't see (and none of its values anywhere), people by name.
// Fictional people and businesses only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  todayIn,
  type Property,
  type View,
} from '@carehub/databases';
import { VIEW_BLOCKED } from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { getJob, scheduleJob } from '../jobs';
import { drainJobsForTest } from '../jobs/testing';
import {
  EXPORT_JOB,
  EXPORT_MESSAGES,
  attachment,
  deleteOldExports,
  type ExportResult,
} from './export';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };
const GONE = { error: { code: 'not_found', message: EXPORT_MESSAGES.notAvailable } };
const BOM = '\uFEFF';
const lines = (...rows: string[]) => BOM + rows.map((row) => `${row}\r\n`).join('');

describe('attachment', () => {
  it('gives a plain ASCII name and the real one in UTF-8', () => {
    expect(attachment('Visits – Open visits – 2026-10-27.csv')).toBe(
      `attachment; filename="Visits - Open visits - 2026-10-27.csv"; ` +
        `filename*=UTF-8''Visits%20%E2%80%93%20Open%20visits%20%E2%80%93%202026-10-27.csv`,
    );
  });

  it('keeps quotes, backslashes and percent signs out of the plain name', () => {
    expect(attachment(`Café "north" \\ 50% (o'clock)*.csv`)).toBe(
      `attachment; filename="Cafe _north_ _ 50_ (o'clock)*.csv"; ` +
        `filename*=UTF-8''Caf%C3%A9%20%22north%22%20%5C%2050%25%20%28o%27clock%29%2A.csv`,
    );
  });

  it('writes a broken character as U+FFFD', () => {
    expect(attachment('Visits \uD800.csv')).toBe(
      `attachment; filename="Visits _.csv"; filename*=UTF-8''Visits%20%EF%BF%BD.csv`,
    );
  });
});

describe.skipIf(!hasDatabase)('database export', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let visitsId: string;
  let position = 0;
  const people = {} as Record<'avery' | 'jordan' | 'riley' | 'casey', TestUser>;
  const ids = {} as Record<string, string>;
  const views = {} as Record<'open' | 'board' | 'byCode' | 'temp', View>;
  const props = {} as Record<string, Property>;

  async function standInWorkspace() {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
      gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL, permissions text[] NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id uuid NOT NULL,
      user_id uuid NOT NULL, role_id uuid, kind text NOT NULL DEFAULT 'member',
      PRIMARY KEY (workspace_id, user_id))`);
    const { rows } = await db.execute<{ id: string }>(
      sql`INSERT INTO workspaces (name) VALUES ('Blue Pine Plumbing') RETURNING id`,
    );
    workspaceId = rows[0]!.id;
  }

  async function person(role: Role, name: string): Promise<TestUser> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${name}`}, ${`{${PERMISSIONS[role].join(',')}}`}::text[])
      RETURNING id`);
    const user = await createUser(db, { name });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role_id)
      VALUES (${workspaceId}, ${user.id}, ${rows[0]!.id})`);
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
    return user;
  }

  async function newDatabase(title: string): Promise<{ id: string; name: Property }> {
    const res = await injectAs(app, people.avery, {
      method: 'POST',
      url: '/api/databases',
      payload: { parentId: pageId, inline: false, title },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { id: body.id, name: body.properties[0] };
  }

  async function addRow(databaseId: string, title: string, values: object, open = true) {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, parent_id, kind, title, position, inherit_access)
      VALUES (${workspaceId}, ${spaceId}, ${databaseId}, 'row', ${title},
        ${`r${String(++position).padStart(4, '0')}`}, ${open})
      RETURNING id`);
    const id = rows[0]!.id;
    await db.execute(sql`
      INSERT INTO db_rows (page_id, database_id, workspace_id, "values", created_by, edited_by)
      VALUES (${id}, ${databaseId}, ${workspaceId}, ${JSON.stringify(values)}::jsonb,
        ${people.avery.id}, ${people.avery.id})`);
    return id;
  }

  async function setViews(databaseId: string, change: (list: View[]) => View[]) {
    const record = await loadDatabase(db, databaseId);
    await changeDatabase(db, databaseId, record!.version, (current) => ({
      views: change(current.views),
    }));
  }

  const text = (value: string) => [{ text: value }];
  const post = (who: TestUser, url: string, payload: object) =>
    injectAs(app, who, { method: 'POST', url, payload });
  const start = (who: TestUser, payload: object, databaseId = visitsId) =>
    post(who, `/api/databases/${databaseId}/export`, payload);
  const download = (who: TestUser, exportId: string, databaseId = visitsId) =>
    injectAs(app, who, { method: 'GET', url: `/api/databases/${databaseId}/exports/${exportId}` });

  /** Starts an export and runs its job; gives the finished job. */
  async function run(who: TestUser, payload: object, databaseId = visitsId) {
    const res = await start(who, payload, databaseId);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: expect.any(String) });
    await drainJobsForTest();
    return (await getJob(res.json().jobId))!;
  }

  async function exported(who: TestUser, payload: object): Promise<ExportResult> {
    const job = await run(who, payload);
    expect(job.status).toBe('succeeded');
    return job.result as ExportResult;
  }

  async function csvOf(who: TestUser, payload: object): Promise<string> {
    const { exportId } = await exported(who, payload);
    const res = await download(who, exportId);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  async function today(user: TestUser) {
    const { rows } = await db.execute<{ time_zone: string }>(
      sql`SELECT time_zone FROM users WHERE id = ${user.id}`,
    );
    return todayIn({ now: new Date(), timeZone: rows[0]!.time_zone });
  }

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    await standInWorkspace();
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');
    people.riley = await person('viewer', 'Riley Chen');
    people.casey = await person('viewer', 'Casey Brooks');

    // Visits: Hours, Status, Tech, Note, a Gate code only Avery sees and a formula reading it.
    const visits = await newDatabase('Visits');
    visitsId = visits.id;
    ids.booked = newId();
    ids.done = newId();
    props.name = visits.name;
    props.hours = newProperty('Hours', defaultConfig('number'));
    props.status = newProperty('Status', {
      type: 'select',
      options: [
        { id: ids.booked, name: 'Booked', color: 'blue' },
        { id: ids.done, name: 'Done', color: 'green' },
      ],
    });
    props.tech = newProperty('Tech', defaultConfig('person'));
    props.note = newProperty('Note', defaultConfig('text'));
    props.gate = {
      ...newProperty('Gate code', defaultConfig('text')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    props.gateNote = newProperty('Gate note', {
      type: 'formula',
      expression: `prop("${props.gate.id}")`,
      resultKind: 'text',
      number: null,
    });
    const all = ['name', 'hours', 'status', 'tech', 'note', 'gate', 'gateNote'].map(
      (k) => props[k]!,
    );
    const shown = (list: Property[]) => list.map((p) => ({ propertyId: p.id, visible: true }));
    views.open = {
      ...defaultView('table', all, { name: 'Open visits' }),
      // Status, Hours, Tech, Note, then the two Avery sees.
      properties: shown([
        props.name!,
        props.status!,
        props.hours!,
        props.tech!,
        props.note!,
      ]).concat(shown([props.gate!, props.gateNote!])),
      filter: {
        kind: 'group',
        id: newId(),
        combinator: 'and',
        children: [
          {
            kind: 'condition',
            id: newId(),
            propertyId: props.status.id,
            op: 'is',
            value: [ids.booked],
          },
        ],
      },
      sorts: [{ propertyId: props.name.id, direction: 'asc' }],
    };
    views.board = {
      ...defaultView('board', all, { name: 'By status' }),
      properties: shown([props.name!, props.hours!, props.status!]),
      sorts: [{ propertyId: props.hours.id, direction: 'desc' }],
    };
    views.byCode = {
      ...defaultView('table', all, { name: 'By code' }),
      sorts: [{ propertyId: props.gate.id, direction: 'asc' }],
    };
    views.temp = defaultView('table', all, { name: 'Scratch' });
    const record = await loadDatabase(db, visitsId);
    await changeDatabase(db, visitsId, record!.version, (current) => ({
      properties: [...current.properties, ...all.slice(1)],
      views: [views.open, views.board, views.byCode, views.temp],
    }));

    ids.boiler = await addRow(visitsId, 'Boiler check', {
      [props.hours.id]: '2',
      [props.status.id]: ids.booked,
      [props.tech.id]: [people.jordan.id],
      [props.note.id]: text('=SUM(A1)'),
      [props.gate.id]: text('4417'),
    });
    ids.leak = await addRow(visitsId, 'Leak fix', {
      [props.hours.id]: '1.5',
      [props.status.id]: ids.done,
    });
    // Jordan can't open this one.
    ids.roof = await addRow(
      visitsId,
      'Roof drain',
      { [props.hours.id]: '3', [props.status.id]: ids.booked, [props.gate.id]: text('9921') },
      false,
    );
    ids.annual = await addRow(visitsId, 'Annual service', {
      [props.hours.id]: '4',
      [props.status.id]: ids.booked,
      [props.tech.id]: [people.avery.id],
      [props.note.id]: text('Bring the long ladder'),
    });
  });

  afterAll(async () => {
    await close?.();
  });

  it('exports This view as the person sees it: its filter, sorts and columns', async () => {
    const result = await exported(people.jordan, { scope: 'view', viewId: views.open.id });
    expect(result).toEqual({
      exportId: expect.any(String),
      fileName: `Visits – Open visits – ${await today(people.jordan)}.csv`,
      rowCount: 2,
    });
    const res = await download(people.jordan, result.exportId);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(attachment(result.fileName));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toBe(
      lines(
        'Name,Status,Hours,Tech,Note',
        'Annual service,Booked,4,Avery Lin,Bring the long ladder',
        "Boiler check,Booked,2,Jordan Park,'=SUM(A1)",
      ),
    );
  });

  it("never writes a hidden property's column or values, or a row they can't open", async () => {
    for (const payload of [
      { scope: 'view', viewId: views.open.id },
      { scope: 'view', viewId: views.board.id },
      { scope: 'all' },
    ]) {
      const csv = await csvOf(people.jordan, payload);
      for (const secret of ['Gate code', 'Gate note', '4417', '9921', 'Roof drain']) {
        expect(csv).not.toContain(secret);
      }
    }
    // Avery may see the Gate code, and the formula that reads it.
    const csv = await csvOf(people.avery, { scope: 'view', viewId: views.open.id });
    expect(csv.split('\r\n')[0]).toBe(`${BOM}Name,Status,Hours,Tech,Note,Gate code,Gate note`);
    expect(csv).toContain("\r\nBoiler check,Booked,2,Jordan Park,'=SUM(A1),4417,4417\r\n");
  });

  it('exports Everything: rows they can open, oldest first, properties they can see', async () => {
    const result = await exported(people.jordan, { scope: 'all' });
    expect(result.fileName).toBe(`Visits – ${await today(people.jordan)}.csv`);
    expect(result.rowCount).toBe(3);
    const res = await download(people.jordan, result.exportId);
    expect(res.body).toBe(
      lines(
        'Name,Hours,Status,Tech,Note',
        "Boiler check,2,Booked,Jordan Park,'=SUM(A1)",
        'Leak fix,1.5,Done,,',
        'Annual service,4,Booked,Avery Lin,Bring the long ladder',
      ),
    );
  });

  it('leaves grouping out: a board comes as one list in its sort order', async () => {
    expect(await csvOf(people.jordan, { scope: 'view', viewId: views.board.id })).toBe(
      lines(
        'Name,Hours,Status',
        'Annual service,4,Booked',
        'Boiler check,2,Booked',
        'Leak fix,1.5,Done',
      ),
    );
  });

  it("refuses a view that uses a property the person can't see", async () => {
    const res = await start(people.jordan, { scope: 'view', viewId: views.byCode.id });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'forbidden', message: VIEW_BLOCKED } });
    expect(await csvOf(people.avery, { scope: 'view', viewId: views.byCode.id })).toContain(
      'Gate code',
    );
  });

  it('answers 400 for a bad body and 404 for an unknown view or another kind of page', async () => {
    for (const body of [
      { scope: 'view' },
      { scope: 'everything' },
      { scope: 'all', extra: true },
      { scope: 'view', viewId: '' },
      {},
    ]) {
      const res = await start(people.jordan, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(INVALID);
    }
    const unknown = await start(people.jordan, { scope: 'view', viewId: newId() });
    expect(unknown.statusCode).toBe(404);
    expect((await start(people.jordan, { scope: 'all' }, pageId)).statusCode).toBe(404);
  });

  it("refuses someone else's export, an unknown one, and any after 24 hours", async () => {
    const { exportId } = await exported(people.jordan, { scope: 'all' });
    for (const res of [
      await download(people.riley, exportId),
      await download(people.jordan, newId()),
      await download(people.jordan, 'not-an-export'),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(GONE);
    }
    expect((await download(people.jordan, exportId)).statusCode).toBe(200);

    await db.execute(sql`UPDATE db_exports SET created_at = now() - interval '25 hours'
      WHERE id = ${exportId}`);
    const late = await download(people.jordan, exportId);
    expect(late.statusCode).toBe(404);
    expect(late.json()).toEqual(GONE);
    const fresh = await exported(people.jordan, { scope: 'all' });
    expect(await deleteOldExports(db)).toBeGreaterThanOrEqual(1);
    const { rows } = await db.execute<{ id: string }>(
      sql`SELECT id FROM db_exports WHERE id IN (${exportId}, ${fresh.exportId})`,
    );
    expect(rows.map((r) => r.id)).toEqual([fresh.exportId]);
  });

  it('runs once per export: running the job again gives the saved file', async () => {
    const first = await exported(people.jordan, { scope: 'all' });
    const again = await scheduleJob({
      kind: EXPORT_JOB,
      payload: {
        exportId: first.exportId,
        databaseId: visitsId,
        viewId: null,
        userId: people.jordan.id,
      },
      key: first.exportId,
    });
    await drainJobsForTest();
    expect((await getJob(again.jobId))?.result).toEqual(first);
    const { rows } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM db_exports WHERE id = ${first.exportId}`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('fails with a fixed message when the view, database or access goes first', async () => {
    const failed = async (job: Awaited<ReturnType<typeof getJob>>, message: string) => {
      expect(job).toMatchObject({ status: 'failed', error: message });
    };

    let res = await start(people.jordan, { scope: 'view', viewId: views.temp.id });
    expect(res.statusCode).toBe(202);
    await setViews(visitsId, (list) => list.filter((v) => v.id !== views.temp.id));
    await drainJobsForTest();
    await failed(await getJob(res.json().jobId), EXPORT_MESSAGES.noView);

    res = await start(people.casey, { scope: 'all' });
    expect(res.statusCode).toBe(202);
    await db.execute(sql`DELETE FROM space_members WHERE principal_id = ${people.casey.id}`);
    await db.execute(sql`DELETE FROM workspace_members WHERE user_id = ${people.casey.id}`);
    await drainJobsForTest();
    await failed(await getJob(res.json().jobId), EXPORT_MESSAGES.noAccess);

    const old = await newDatabase('Old visits');
    await addRow(old.id, 'Valve swap', {});
    res = await start(people.jordan, { scope: 'all' }, old.id);
    expect(res.statusCode).toBe(202);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${old.id}`);
    await drainJobsForTest();
    await failed(await getJob(res.json().jobId), EXPORT_MESSAGES.gone);
  });
});
