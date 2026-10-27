// POST /api/databases/:id/chart and GET /api/databases/:id/rows/pick on a real database (decision
// 0200, W2-3), and computedAsText, the values a type change to Text keeps: only rows the viewer can
// open, property access, formulas and rollups, override filters, the viewed event and the error
// messages. Fictional people and businesses only.
import {
  defaultConfig,
  defaultView,
  fromPlainText,
  newId,
  newProperty,
  relationConfig,
  type EvalContext,
  type Property,
  type View,
  type Viewer,
} from '@carehub/databases';
import { planConversion } from '@carehub/databases/convert';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { computedAsText } from './as-text';
import { changeDatabase, loadDatabase, loadRows } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const BLOCKED = { blocked: "This view uses a property you can't see." };

type Point = { value: number | null; rowIds: string[] };
type Chart = { categories: { label: string; total: Point }[]; valueLabel: string };
type Pick = { id: string; title: string; icon: string | null };

describe.skipIf(!hasDatabase)('charts, row pickers and values as shown', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let position = 0;
  const people = {} as Record<'avery' | 'jordan', TestUser>;
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
      sql`INSERT INTO workspaces (name) VALUES ('Cedar Row Dental') RETURNING id`,
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
  const seeOnly = (p: Property, who: TestUser): Property => ({
    ...p,
    access: { see: [{ type: 'user', id: who.id }], change: null },
  });
  const formula = (name: string, expression: string, resultKind: 'number' | 'text' = 'number') =>
    newProperty(name, { type: 'formula', expression, resultKind, number: null });
  /** A bar chart of Jobs by Stage: a count, or the sum of `valueId`. */
  const chartView = (name: string, all: Property[], valueId: string | null = null): View => {
    const view = defaultView('chart', all, { name });
    return {
      ...view,
      sorts: [{ propertyId: all[0]!.id, direction: 'asc' }],
      chart: {
        ...view.chart!,
        xPropertyId: props.stage!.id,
        value: { aggregate: valueId ? 'sum' : 'count', propertyId: valueId },
      },
    };
  };
  const viewerOf = (who: TestUser): Viewer => ({
    userId: who.id,
    timeZone: 'America/Denver',
    weekStart: 0,
    hour12: true,
    now: new Date('2026-10-27T15:00:00Z'),
  });

  const chart = (who: TestUser, body: object, databaseId = ids.jobs!) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${databaseId}/chart`,
      payload: body,
    });
  /** Each bar: its label and value. */
  const bars = (body: Chart) => body.categories.map((c) => [c.label, c.total.value]);
  const pick = (who: TestUser, query = '', databaseId = ids.visits!) =>
    injectAs(app, who, { method: 'GET', url: `/api/databases/${databaseId}/rows/pick${query}` });
  const titles = async (who: TestUser, q: string) =>
    ((await pick(who, `?q=${encodeURIComponent(q)}`)).json() as Pick[]).map((r) => r.title);

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    await standInWorkspace();
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Front desk') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const home = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position, inherit_access)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Call-outs', 'p0', true) RETURNING id`);
    pageId = home.rows[0]!.id;
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');

    // Clients: Calls, and a Gate code only Avery sees.
    const clients = await newDatabase('Clients');
    ids.clients = clients.id;
    props.calls = newProperty('Calls', defaultConfig('number'));
    props.gate = seeOnly(newProperty('Gate code', defaultConfig('text')), people.avery);
    const clientProps = [clients.name, props.calls, props.gate];
    await setSchema(clients.id, clientProps.slice(1), [defaultView('table', clientProps)]);

    // Jobs: Hours, Rate, Total, Client with a rollup of its Calls, a formula reading the hidden
    // Gate code, Stage, and a Cost only Avery sees.
    const jobs = await newDatabase('Jobs');
    ids.jobs = jobs.id;
    props.hours = newProperty('Hours', defaultConfig('number'));
    props.rate = newProperty('Rate', defaultConfig('number'));
    props.total = formula('Total', `prop("${props.hours.id}") * prop("${props.rate.id}")`);
    props.client = newProperty('Client', relationConfig(clients.id));
    props.clientCalls = newProperty('Client calls', {
      type: 'rollup',
      relationPropertyId: props.client.id,
      targetPropertyId: props.calls.id,
      aggregate: 'sum',
      number: null,
    });
    props.gateCopy = formula(
      'Gate copy',
      `prop("${props.client.id}").first().prop("${props.gate.id}")`,
      'text',
    );
    ids.booked = newId();
    ids.done = newId();
    props.stage = newProperty('Stage', {
      type: 'select',
      options: [
        { id: ids.booked, name: 'Booked', color: 'blue' },
        { id: ids.done, name: 'Done', color: 'green' },
      ],
    });
    props.cost = seeOnly(newProperty('Cost', defaultConfig('number')), people.avery);
    const jobProps = [
      jobs.name,
      props.hours,
      props.rate,
      props.total,
      props.client,
      props.clientCalls,
      props.gateCopy,
      props.stage,
      props.cost,
    ];
    views.table = defaultView('table', jobProps, { name: 'All jobs' });
    views.count = chartView('Jobs by stage', jobProps);
    views.hours = chartView('Hours by stage', jobProps, props.hours.id);
    views.total = chartView('Total by stage', jobProps, props.total.id);
    views.calls = chartView('Client calls by stage', jobProps, props.clientCalls.id);
    views.cost = chartView('Cost by stage', jobProps, props.cost.id);
    await setSchema(jobs.id, jobProps.slice(1), [
      views.table,
      views.count,
      views.hours,
      views.total,
      views.calls,
      views.cost,
    ]);

    ids.c1 = await addRow(clients.id, 'Blue Pine Plumbing', {
      [props.calls.id]: '3',
      [props.gate.id]: text('4411'),
    });
    ids.c2 = await addRow(clients.id, 'Cedar Row Dental', { [props.calls.id]: '5' });
    ids.c3 = await addRow(clients.id, 'Harbor Light Bakery', { [props.calls.id]: '7' }, false);
    ids.j1 = await addRow(jobs.id, 'Boiler check', {
      [props.hours.id]: '2',
      [props.rate.id]: '40',
      [props.client.id]: [ids.c1, ids.c3],
      [props.stage.id]: ids.booked,
      [props.cost.id]: '100',
    });
    ids.j2 = await addRow(jobs.id, 'Leak fix', {
      [props.hours.id]: '1.5',
      [props.rate.id]: '60',
      [props.client.id]: [ids.c2],
      [props.stage.id]: ids.done,
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
      [props.hours.id]: '1',
      [props.rate.id]: '50',
      [props.stage.id]: ids.done,
    });

    // Visits, for the row picker: 25 numbered ones and a few more, one private, one in Trash.
    const visits = await newDatabase('Visits');
    ids.visits = visits.id;
    for (let i = 1; i <= 25; i++) {
      await addRow(visits.id, `Visit ${String(i).padStart(2, '0')}`, {});
    }
    for (const title of ['Boiler check', 'Check valves', 'Café sink repair']) {
      await addRow(visits.id, title, {});
    }
    await addRow(visits.id, 'Alarm test', {}, false);
    const trashed = await addRow(visits.id, 'Annual review', {});
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${trashed}`);
  });

  afterAll(async () => {
    await close?.();
  });

  it('counts and adds up the rows the viewer can open, by stage', async () => {
    const count = await chart(people.jordan, { viewId: views.count!.id });
    expect(count.statusCode).toBe(200);
    const body = count.json();
    // Drain survey is private: not counted.
    expect(bars(body)).toEqual([
      ['Booked', 1],
      ['Done', 2],
    ]);
    expect(body.categories.map((c: Chart['categories'][number]) => c.total.rowIds)).toEqual([
      [ids.j1],
      [ids.j4, ids.j2],
    ]);
    expect(body).toMatchObject({ problem: null, valueLabel: 'Count', timedOut: false });
    const hours = (await chart(people.jordan, { viewId: views.hours!.id })).json();
    expect(hours.valueLabel).toBe('Sum of Hours');
    expect(bars(hours)).toEqual([
      ['Booked', 2],
      ['Done', 2.5],
    ]);
    // Formulas and rollups, worked out on the server: Harbor Light Bakery is private, so its
    // calls aren't in the rollup.
    expect(bars((await chart(people.jordan, { viewId: views.total!.id })).json())).toEqual([
      ['Booked', 80],
      ['Done', 140],
    ]);
    expect(bars((await chart(people.jordan, { viewId: views.calls!.id })).json())).toEqual([
      ['Booked', 3],
      ['Done', 5],
    ]);
  });

  it('applies an override filter', async () => {
    const body = (
      await chart(people.jordan, {
        viewId: views.count!.id,
        override: {
          filter: {
            kind: 'group',
            id: 'f1',
            combinator: 'and',
            children: [
              {
                kind: 'condition',
                id: 'f2',
                propertyId: views.table!.properties[0]!.propertyId,
                op: 'contains',
                value: 'leak',
              },
            ],
          },
        },
      })
    ).json();
    expect(bars(body)).toEqual([['Done', 1]]);
  });

  it('answers only { blocked } for a chart of a property the viewer can’t see', async () => {
    const blocked = await chart(people.jordan, { viewId: views.cost!.id });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toEqual(BLOCKED);
    expect(bars((await chart(people.avery, { viewId: views.cost!.id })).json())).toEqual([
      ['Booked', 100],
      ['Done', 50],
    ]);
  });

  it('emits databases.database.viewed for a chart, not for a blocked one', async () => {
    const seen: unknown[] = [];
    const off = app.events.on('databases.database.viewed', (event) => {
      seen.push(event);
    });
    try {
      await chart(people.jordan, { viewId: views.count!.id });
      await chart(people.jordan, { viewId: views.cost!.id });
      await app.events.settled();
      expect(seen).toEqual([
        { workspaceId, databaseId: ids.jobs, viewId: views.count!.id, userId: people.jordan.id },
      ]);
    } finally {
      off();
    }
  });

  it('refuses bad bodies, views that aren’t charts and pages that aren’t databases', async () => {
    expect((await chart(people.jordan, {})).json()).toEqual(INVALID);
    const extra = await chart(people.jordan, { viewId: views.count!.id, search: 'leak' });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual(INVALID);
    for (const viewId of [views.table!.id, newId()]) {
      const res = await chart(people.jordan, { viewId });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    }
    const notDatabase = await chart(people.jordan, { viewId: views.count!.id }, pageId);
    expect(notDatabase.statusCode).toBe(404);
    expect(notDatabase.json()).toEqual(NOT_FOUND);
  });

  it('lists 20 rows the viewer can open for a relation picker, A to Z', async () => {
    const res = await pick(people.jordan);
    expect(res.statusCode).toBe(200);
    const list = res.json() as Pick[];
    // Alarm test is private and Annual review is in Trash.
    expect(list.map((r) => r.title)).toEqual([
      'Boiler check',
      'Café sink repair',
      'Check valves',
      ...Array.from({ length: 17 }, (_, i) => `Visit ${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(list[0]).toEqual({ id: expect.any(String), title: 'Boiler check', icon: null });
  });

  it('matches every word of the search, ignoring case and accents, starts first', async () => {
    expect(await titles(people.jordan, 'check')).toEqual(['Check valves', 'Boiler check']);
    expect(await titles(people.jordan, 'CAFE')).toEqual(['Café sink repair']);
    expect(await titles(people.jordan, 'sink café')).toEqual(['Café sink repair']);
    expect(await titles(people.jordan, 'visit 2')).toEqual([
      'Visit 20',
      'Visit 21',
      'Visit 22',
      'Visit 23',
      'Visit 24',
      'Visit 25',
      'Visit 02',
      'Visit 12',
    ]);
    expect(await titles(people.jordan, 'alarm')).toEqual([]);
    expect(await titles(people.jordan, 'annual')).toEqual([]);
    expect(await titles(people.avery, 'boiler')).toEqual(['Boiler check']);
  });

  it('refuses bad picker searches and pages that aren’t databases', async () => {
    const long = await pick(people.jordan, `?q=${'x'.repeat(501)}`);
    expect(long.statusCode).toBe(400);
    expect(long.json()).toEqual(INVALID);
    expect((await pick(people.jordan, '?color=red')).json()).toEqual(INVALID);
    const notDatabase = await pick(people.jordan, '', pageId);
    expect(notDatabase.statusCode).toBe(404);
    expect(notDatabase.json()).toEqual(NOT_FOUND);
  });

  it('works out formula and rollup values as the person changing the type sees them', async () => {
    const record = (await loadDatabase(db, ids.jobs!))!;
    const rows = await loadRows(db, ids.jobs!);
    const row = (id: string) => rows.find((r) => r.id === id)!;
    const avery = await computedAsText(db, {
      record,
      userId: people.avery.id,
      viewer: viewerOf(people.avery),
      rows,
    });
    expect(avery.computed(row(ids.j1!), props.total!.id)).toEqual({ kind: 'number', value: 80 });
    expect(avery.computed(row(ids.j1!), props.clientCalls!.id)).toEqual({
      kind: 'number',
      value: 3,
    });
    expect(avery.computed(row(ids.j1!), props.gateCopy!.id)).toEqual({
      kind: 'text',
      value: '4411',
    });
    expect(avery.rowTitle(ids.c1!)).toBe('Blue Pine Plumbing');
    expect(avery.rowTitle(ids.c3!)).toBeUndefined();
    expect(avery.timedOut).toBe(false);
    // Jordan can't see the Gate code, so the formula that reads it is empty for him.
    const jordan = await computedAsText(db, {
      record,
      userId: people.jordan.id,
      viewer: viewerOf(people.jordan),
      rows,
    });
    expect(jordan.computed(row(ids.j1!), props.gateCopy!.id)).toEqual({ kind: 'empty' });
    expect(jordan.computed(row(ids.j1!), props.total!.id)).toEqual({ kind: 'number', value: 80 });

    // planConversion keeps them as text, also for a row Avery can't open.
    const ctx: EvalContext = {
      properties: record.properties,
      viewer: viewerOf(people.avery),
      userName: () => undefined,
      computed: avery.computed,
      rowTitle: avery.rowTitle,
      isRemovedUser: avery.isRemovedUser,
    };
    const total = planConversion(props.total!, defaultConfig('text'), rows, ctx);
    expect(Object.fromEntries(total.values)).toEqual({
      [ids.j1!]: fromPlainText('80'),
      [ids.j2!]: fromPlainText('90'),
      [ids.j3!]: fromPlainText('120'),
      [ids.j4!]: fromPlainText('50'),
    });
    const gate = planConversion(props.gateCopy!, defaultConfig('text'), rows, ctx);
    expect(Object.fromEntries(gate.values)).toEqual({ [ids.j1!]: fromPlainText('4411') });
  });
});
