// listViewRows and exportViewCsv on a real database (decision 0200, W2-3): a saved view's rows for
// one person as POST /:id/query answers them, paging, CSV exports of This view and Everything
// (Databases spec 3.8, DB-14), property and row access, blocked views and the refusals.
// Fictional people and businesses only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  type Property,
  type View,
} from '@carehub/databases';
import { QUERY_TOO_SLOW, type ViewQueryData } from '@carehub/databases/engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { changeDatabase, loadDatabase } from './store';
import { exportViewCsv, listViewRows } from './view-rows';

type Role = 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const BLOCKED_MESSAGE = "This view uses a property you can't see.";
const NOW = new Date('2026-10-27T15:00:00Z');
/** A CSV file's text: byte order mark, then each line with CRLF. */
const csvOf = (...lines: string[]) => '\uFEFF' + lines.map((l) => `${l}\r\n`).join('');

describe.skipIf(!hasDatabase)('view rows and CSV exports for other lanes', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let position = 0;
  const people = {} as Record<'avery' | 'jordan' | 'morgan', TestUser>;
  const ids = {} as Record<string, string>;
  const views = {} as Record<string, View>;
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

  async function addRow(
    databaseId: string,
    title: string,
    values: Record<string, unknown>,
    open = true,
  ): Promise<string> {
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

  async function setSchema(id: string, add: Property[], viewList: View[]) {
    const record = await loadDatabase(db, id);
    await changeDatabase(db, id, record!.version, (current) => ({
      properties: [...current.properties, ...add],
      views: viewList,
    }));
  }

  const text = (value: string) => [{ text: value }];
  const titles = (answer: unknown) => (answer as ViewQueryData).rows.map((r) => r.title);
  const list = (who: TestUser, viewId: string, cursor?: string | null) =>
    listViewRows(db, { userId: who.id, databaseId: ids.jobs!, viewId, cursor });
  const csv = (who: TestUser, viewId: string | null, more: object = {}) =>
    exportViewCsv(db, { userId: who.id, databaseId: ids.jobs!, viewId, now: NOW, ...more });

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    await standInWorkspace();
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Field team') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const home = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position, inherit_access)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'p0', true) RETURNING id`);
    pageId = home.rows[0]!.id;
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');
    // Morgan has an account but isn't in this workspace.
    people.morgan = await createUser(db, { name: 'Morgan Reyes' });
    // Jordan works from Auckland, where it's already Oct 28.
    await db.execute(
      sql`UPDATE users SET time_zone = 'Pacific/Auckland' WHERE id = ${people.jordan.id}`,
    );

    // Jobs: Notes, Hours, Rate, Total (a formula), Stage, Done, and a Cost only Avery sees.
    const jobs = await newDatabase('Jobs');
    ids.jobs = jobs.id;
    props.notes = newProperty('Notes', defaultConfig('text'));
    props.hours = newProperty('Hours', defaultConfig('number'));
    props.rate = newProperty('Rate', defaultConfig('number'));
    props.total = newProperty('Total', {
      type: 'formula',
      expression: `prop("${props.hours.id}") * prop("${props.rate.id}")`,
      resultKind: 'number',
      number: null,
    });
    ids.booked = newId();
    ids.done = newId();
    props.stage = newProperty('Stage', {
      type: 'select',
      options: [
        { id: ids.booked, name: 'Booked', color: 'blue' },
        { id: ids.done, name: 'Done', color: 'green' },
      ],
    });
    props.done = newProperty('Done', defaultConfig('checkbox'));
    props.cost = {
      ...newProperty('Cost', defaultConfig('number')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    const jobProps = [
      jobs.name,
      props.notes,
      props.hours,
      props.rate,
      props.total,
      props.stage,
      props.done,
      props.cost,
    ];
    views.all = defaultView('table', jobProps, { name: 'All jobs' });
    // Open: Hours of 2 or more, most hours first, grouped by Stage; Name, Notes, Total, Cost and
    // Hours shown, in that order.
    const shown = [jobs.name, props.notes, props.total, props.cost, props.hours];
    views.open = {
      ...defaultView('table', jobProps, { name: 'Open' }),
      filter: {
        kind: 'group',
        id: 'f1',
        combinator: 'and',
        children: [
          { kind: 'condition', id: 'f2', propertyId: props.hours.id, op: 'gte', value: '2' },
        ],
      },
      sorts: [{ propertyId: props.hours.id, direction: 'desc' }],
      grouping: { propertyId: props.stage.id },
      properties: [
        ...shown.map((p) => ({ propertyId: p.id, visible: true })),
        ...[props.rate, props.stage, props.done].map((p) => ({ propertyId: p.id, visible: false })),
      ],
    };
    views.byCost = {
      ...defaultView('table', jobProps, { name: 'By cost' }),
      sorts: [{ propertyId: props.cost.id, direction: 'asc' }],
    };
    await setSchema(jobs.id, jobProps.slice(1), [views.all, views.open, views.byCost]);

    ids.j1 = await addRow(jobs.id, 'Boiler check', {
      [props.notes.id]: text('=SUM(1)'),
      [props.hours.id]: '2',
      [props.rate.id]: '40',
      [props.stage.id]: ids.booked,
      [props.cost.id]: '100',
    });
    ids.j2 = await addRow(jobs.id, 'Leak fix', {
      [props.notes.id]: text('Under sink, left side'),
      [props.hours.id]: '1.5',
      [props.rate.id]: '60',
      [props.stage.id]: ids.done,
      [props.done.id]: true,
      [props.cost.id]: '50',
    });
    // Nobody here can open Drain survey.
    ids.j3 = await addRow(
      jobs.id,
      'Drain survey',
      { [props.hours.id]: '4', [props.rate.id]: '30', [props.stage.id]: ids.booked },
      false,
    );
    ids.j4 = await addRow(jobs.id, 'Fit valve', {
      [props.notes.id]: text('Bring 2 valves'),
      [props.hours.id]: '3',
      [props.rate.id]: '50',
      [props.stage.id]: ids.done,
    });

    // Visits: 12 rows and a view that loads 10 at a time.
    const visits = await newDatabase('Visits');
    ids.visits = visits.id;
    views.visits = { ...defaultView('table', [visits.name], { name: 'Recent' }), loadLimit: 10 };
    await setSchema(visits.id, [], [views.visits]);
    for (let i = 1; i <= 12; i++) {
      await addRow(visits.id, `Visit ${String(i).padStart(2, '0')}`, {});
    }
  });

  afterAll(async () => {
    await close?.();
  });

  it('lists a view’s rows for one person, as POST /:id/query answers them', async () => {
    const jordan = await list(people.jordan, views.all!.id);
    // Drain survey is private, and Jordan can't see Cost.
    expect(titles(jordan)).toEqual(['Boiler check', 'Leak fix', 'Fit valve']);
    const data = jordan as ViewQueryData;
    expect(data.count).toBe(3);
    expect(data.propertyIds).not.toContain(props.cost!.id);
    expect(data.rows.every((r) => !(props.cost!.id in r.values))).toBe(true);
    expect(data.rows[0]!.computed[props.total!.id]).toEqual({ kind: 'number', value: 80 });
    const res = await injectAs(app, people.jordan, {
      method: 'POST',
      url: `/api/databases/${ids.jobs}/query`,
      payload: { viewId: views.all!.id },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(JSON.stringify(jordan))).toEqual(res.json());

    const avery = (await list(people.avery, views.all!.id)) as ViewQueryData;
    expect(avery.propertyIds).toContain(props.cost!.id);
    expect(avery.rows[0]!.values[props.cost!.id]).toBe('100');
  });

  it('pages through a view with its cursor', async () => {
    const page = (cursor?: string | null) =>
      listViewRows(db, {
        userId: people.jordan.id,
        databaseId: ids.visits!,
        viewId: views.visits!.id,
        cursor,
      }) as Promise<ViewQueryData>;
    const first = await page();
    expect(titles(first)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Visit ${String(i + 1).padStart(2, '0')}`),
    );
    expect(first.count).toBe(12);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await page(first.nextCursor);
    expect(titles(second)).toEqual(['Visit 11', 'Visit 12']);
    expect(second.nextCursor).toBeNull();
  });

  it('answers only { blocked } for a view that uses a property the person can’t see', async () => {
    expect(await list(people.jordan, views.byCost!.id)).toEqual({ blocked: BLOCKED_MESSAGE });
    expect(titles(await list(people.avery, views.byCost!.id))).toEqual([
      'Leak fix',
      'Boiler check',
      'Fit valve',
    ]);
  });

  it('refuses unknown views, outsiders, long cursors and pages that aren’t databases', async () => {
    await expect(list(people.jordan, newId())).rejects.toMatchObject({
      statusCode: 404,
      code: 'not_found',
    });
    await expect(list(people.morgan, views.all!.id)).rejects.toMatchObject({
      statusCode: 403,
      code: 'forbidden',
      message: "You don't have access to this.",
    });
    await expect(list(people.jordan, views.all!.id, 'x'.repeat(25_001))).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid',
    });
    for (const databaseId of [pageId, 'not-a-database']) {
      await expect(
        listViewRows(db, { userId: people.jordan.id, databaseId, viewId: views.all!.id }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    }
  });

  it('exports This view: filter and sorts, no grouping, visible properties in view order', async () => {
    // Fit valve (3 hours) comes before Boiler check (2 hours), though Booked is the first group.
    expect(await csv(people.jordan, views.open!.id)).toEqual({
      fileName: 'Jobs – Open – 2026-10-28.csv',
      csv: csvOf(
        'Name,Notes,Total,Hours',
        'Fit valve,Bring 2 valves,150,3',
        "Boiler check,'=SUM(1),80,2",
      ),
      rowCount: 2,
      timedOut: false,
    });
    expect(await csv(people.avery, views.open!.id)).toEqual({
      fileName: 'Jobs – Open – 2026-10-27.csv',
      csv: csvOf(
        'Name,Notes,Total,Cost,Hours',
        'Fit valve,Bring 2 valves,150,,3',
        "Boiler check,'=SUM(1),80,100,2",
      ),
      rowCount: 2,
      timedOut: false,
    });
  });

  it('exports Everything: every row and property the person can see, oldest first', async () => {
    expect(await csv(people.jordan, null)).toEqual({
      fileName: 'Jobs – 2026-10-28.csv',
      csv: csvOf(
        'Name,Notes,Hours,Rate,Total,Stage,Done',
        "Boiler check,'=SUM(1),2,40,80,Booked,No",
        'Leak fix,"Under sink, left side",1.5,60,90,Done,Yes',
        'Fit valve,Bring 2 valves,3,50,150,Done,No',
      ),
      rowCount: 3,
      timedOut: false,
    });
    const avery = await csv(people.avery, null);
    expect(avery.csv.split('\r\n').slice(0, 2)).toEqual([
      '\uFEFFName,Notes,Hours,Rate,Total,Stage,Done,Cost',
      "Boiler check,'=SUM(1),2,40,80,Booked,No,100",
    ]);
  });

  it('writes "⚠ Too slow" for formulas past the time limit', async () => {
    let t = 0;
    const slow = await csv(people.avery, views.open!.id, { clock: () => ++t, budgetMs: 0 });
    expect(slow.timedOut).toBe(true);
    expect(slow.csv).toBe(
      csvOf(
        'Name,Notes,Total,Cost,Hours',
        `Fit valve,Bring 2 valves,${QUERY_TOO_SLOW},,3`,
        `Boiler check,'=SUM(1),${QUERY_TOO_SLOW},100,2`,
      ),
    );
  });

  it('refuses blocked views (403), unknown views and outsiders', async () => {
    await expect(csv(people.jordan, views.byCost!.id)).rejects.toMatchObject({
      statusCode: 403,
      code: 'forbidden',
      message: BLOCKED_MESSAGE,
    });
    await expect(csv(people.avery, views.byCost!.id)).resolves.toMatchObject({ rowCount: 3 });
    await expect(csv(people.jordan, newId())).rejects.toMatchObject({ statusCode: 404 });
    for (const viewId of [views.open!.id, null]) {
      await expect(csv(people.morgan, viewId)).rejects.toMatchObject({
        statusCode: 403,
        code: 'forbidden',
      });
    }
  });
});
