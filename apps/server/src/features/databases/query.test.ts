// POST /api/databases/:id/query on a real database (decision 0200, W2-3): flat, grouped and
// sub-grouped views, search, overrides, paging, property access (blocked views, hidden chains),
// row access, formulas, rollups, relation and mention titles, people, sub-items, the viewed event
// and the error messages, the ID search ("QA-5") and the per-person limit. Fictional people and
// businesses only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  relationConfig,
  type Property,
  type View,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { getDefaultWorkspace } from '../workspaces';
import { BUSY_MESSAGE } from './query-limit';
import { changeDatabase, loadDatabase } from './store';

const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const BLOCKED = { blocked: "This view uses a property you can't see." };

type QueryRow = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  computed: Record<string, unknown>;
  hiddenLinks: Record<string, number>;
  depth?: number;
  parentId?: string | null;
};

describe.skipIf(!hasDatabase)('view queries', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let privatePageId: string;
  let position = 0;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  const ids = {} as Record<string, string>;
  const views = {} as Record<string, View>;
  const props = {} as Record<string, Property>;

  /** A member with a built-in role who has joined the Operations space. */
  async function person(role: 'admin' | 'editor' | 'viewer', name: string): Promise<TestUser> {
    const user = await createUser(db, { role, name });
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
    return user;
  }

  async function page(title: string, open = true): Promise<string> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position, inherit_access)
      VALUES (${workspaceId}, ${spaceId}, 'page', ${title}, ${`p${++position}`}, ${open})
      RETURNING id`);
    return rows[0]!.id;
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

  async function setSchema(id: string, add: Property[], viewList: View[], more = {}) {
    const record = await loadDatabase(db, id);
    await changeDatabase(db, id, record!.version, (current) => ({
      properties: [...current.properties, ...add],
      views: viewList,
      ...more,
    }));
  }

  const formula = (name: string, expression: string, resultKind: 'number' | 'text' = 'number') =>
    newProperty(name, { type: 'formula', expression, resultKind, number: null });
  const text = (value: string) => [{ text: value }];
  const seeOnly = (p: Property, who: TestUser): Property => ({
    ...p,
    access: { see: [{ type: 'user', id: who.id }], change: null },
  });

  const query = (who: TestUser, body: object, databaseId = ids.jobs!) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${databaseId}/query`,
      payload: body,
    });
  const rowsOf = (body: { rows: QueryRow[] }) => body.rows;
  const rowById = (body: { rows: QueryRow[] }, id: string) => {
    const found = body.rows.find((r) => r.id === id);
    if (!found) throw new Error(`row ${id} is missing`);
    return found;
  };

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    workspaceId = (await getDefaultWorkspace(db))!.id;
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    pageId = await page('Call-outs');
    privatePageId = await page('Owner notes', false);
    people.admin = await person('admin', 'Morgan Reyes');
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');

    // Clients: Region, Gate code (only Avery sees it) and Calls.
    const clients = await newDatabase('Clients');
    ids.clients = clients.id;
    props.region = newProperty('Region', defaultConfig('text'));
    props.gate = seeOnly(newProperty('Gate code', defaultConfig('text')), people.avery);
    props.calls = newProperty('Calls', defaultConfig('number'));
    const clientProps = [clients.name, props.region, props.gate, props.calls];
    views.clients = defaultView('table', clientProps);
    await setSchema(clients.id, clientProps.slice(1), [views.clients]);

    // Jobs: numbers and a formula, a relation with a rollup, a formula reading the hidden Gate
    // code, Stage, Urgent, Crew, Notes, and an Access code and a Lead only Avery sees.
    const jobs = await newDatabase('Jobs');
    ids.jobs = jobs.id;
    props.jobName = jobs.name;
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
    props.urgent = newProperty('Urgent', defaultConfig('checkbox'));
    props.crew = newProperty('Crew', defaultConfig('person'));
    props.notes = newProperty('Notes', defaultConfig('text'));
    props.code = seeOnly(newProperty('Access code', defaultConfig('text')), people.avery);
    props.lead = seeOnly(newProperty('Lead', defaultConfig('person')), people.avery);
    const jobProps = [
      jobs.name,
      props.hours,
      props.rate,
      props.total,
      props.client,
      props.clientCalls,
      props.gateCopy,
      props.stage,
      props.urgent,
      props.crew,
      props.notes,
      props.code,
      props.lead,
    ];
    const byName = [{ propertyId: jobs.name.id, direction: 'asc' as const }];
    const grouping = (propertyId: string) => ({
      propertyId,
      sort: 'manual' as const,
      order: [],
      hidden: [],
      hideEmpty: false,
    });
    views.all = { ...defaultView('table', jobProps, { name: 'All jobs' }), sorts: byName };
    views.board = {
      ...defaultView('board', jobProps, { name: 'By stage' }),
      sorts: byName,
      grouping: grouping(props.stage.id),
      subGrouping: grouping(props.urgent.id),
    };
    views.grouped = {
      ...defaultView('table', jobProps, { name: 'Grouped' }),
      sorts: byName,
      grouping: grouping(props.stage.id),
    };
    views.codes = {
      ...defaultView('table', jobProps, { name: 'Codes' }),
      sorts: [{ propertyId: props.code.id, direction: 'asc' }],
    };
    await setSchema(jobs.id, jobProps.slice(1), [
      views.all,
      views.board,
      views.grouped,
      views.codes,
    ]);

    ids.c1 = await addRow(clients.id, 'Blue Pine Plumbing', {
      [props.region.id]: text('North'),
      [props.gate.id]: text('4411'),
      [props.calls.id]: '3',
    });
    ids.c2 = await addRow(clients.id, 'Cedar Row Dental', { [props.calls.id]: '5' });
    ids.c3 = await addRow(clients.id, 'Harbor Light Bakery', { [props.calls.id]: '7' }, false);
    ids.j1 = await addRow(jobs.id, 'Boiler check', {
      [props.hours.id]: '2',
      [props.rate.id]: '40',
      [props.client.id]: [ids.c1, ids.c3],
      [props.stage.id]: ids.booked,
      [props.urgent.id]: true,
      [props.crew.id]: [people.jordan.id],
      [props.notes.id]: [
        { text: 'See ' },
        { text: 'Call-outs', mention: { kind: 'page', id: pageId } },
        { text: ' and ' },
        { text: 'Owner notes', mention: { kind: 'page', id: privatePageId } },
      ],
      [props.code.id]: text('1234'),
      [props.lead.id]: [people.admin.id],
    });
    ids.j2 = await addRow(jobs.id, 'Leak fix', {
      [props.hours.id]: '1.5',
      [props.rate.id]: '60',
      [props.client.id]: [ids.c2],
      [props.stage.id]: ids.done,
    });
    ids.j3 = await addRow(jobs.id, 'Drain survey', { [props.stage.id]: ids.booked }, false);
  });

  afterAll(async () => {
    await close?.();
  });

  it('answers a table view with formulas, rollups and only the rows and links the viewer can open', async () => {
    const res = await query(people.jordan, { viewId: views.all!.id });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(rowsOf(body).map((r: QueryRow) => r.title)).toEqual(['Boiler check', 'Leak fix']);
    expect(body).toMatchObject({ count: 2, nextCursor: null, groups: null, continued: false });
    const j1 = rowById(body, ids.j1!);
    expect(j1.computed[props.total!.id]).toEqual({ kind: 'number', value: 80 });
    // Harbor Light Bakery is private: not in the rollup, the cell or the titles.
    expect(j1.computed[props.clientCalls!.id]).toEqual({ kind: 'number', value: 3 });
    expect(j1.values[props.client!.id]).toEqual([ids.c1]);
    expect(j1.hiddenLinks[props.client!.id]).toBe(1);
    expect(body.rowTitles).toEqual({
      [ids.c1!]: 'Blue Pine Plumbing',
      [ids.c2!]: 'Cedar Row Dental',
    });
    expect(rowById(body, ids.j2!).computed[props.total!.id]).toEqual({ kind: 'number', value: 90 });
    // Mentions of pages Jordan can't open lose their title.
    expect(j1.values[props.notes!.id]).toEqual([
      { text: 'See ' },
      { text: 'Call-outs', mention: { kind: 'page', id: pageId } },
      { text: ' and ' },
      { text: '', mention: { kind: 'page', id: privatePageId } },
    ]);
    expect(body.people).toEqual({
      [people.avery.id]: { name: 'Avery Lin', avatarUrl: null },
      [people.jordan.id]: { name: 'Jordan Park', avatarUrl: null },
    });
  });

  it('leaves out hidden properties and the formulas that read them, here or related', async () => {
    const jordan = (await query(people.jordan, { viewId: views.all!.id })).json();
    expect(jordan.propertyIds).not.toContain(props.code!.id);
    expect(jordan.propertyIds).not.toContain(props.gateCopy!.id);
    expect(jordan.propertyIds).toContain(props.clientCalls!.id);
    const j1 = rowById(jordan, ids.j1!);
    expect(j1.values).not.toHaveProperty(props.code!.id);
    expect(j1.computed).not.toHaveProperty(props.gateCopy!.id);

    const avery = (await query(people.avery, { viewId: views.all!.id })).json();
    expect(avery.propertyIds).toContain(props.gateCopy!.id);
    expect(rowById(avery, ids.j1!).computed[props.gateCopy!.id]).toEqual({
      kind: 'text',
      value: '4411',
    });
  });

  it("finds nothing by values the viewer can't see", async () => {
    // Gate code (Clients) and Access code (Jobs) are Avery's only.
    const idsOf = async (who: TestUser, body: object, databaseId?: string) =>
      rowsOf((await query(who, body, databaseId)).json()).map((r: QueryRow) => r.id);
    const gate = { viewId: views.clients!.id, search: '4411' };
    expect(await idsOf(people.avery, gate, ids.clients)).toEqual([ids.c1]);
    expect(await idsOf(people.jordan, gate, ids.clients)).toEqual([]);
    const code = { viewId: views.all!.id, search: '1234' };
    expect(await idsOf(people.avery, code)).toEqual([ids.j1]);
    expect(await idsOf(people.jordan, code)).toEqual([]);
  });

  it("names only the people the viewer's properties show, and marks removed ones", async () => {
    // Morgan Reyes is named only in Lead, which only Avery sees.
    const jordan = (await query(people.jordan, { viewId: views.all!.id })).json();
    expect(jordan.people).not.toHaveProperty(people.admin.id);
    const avery = (await query(people.avery, { viewId: views.all!.id })).json();
    expect(avery.people[people.admin.id]).toEqual({ name: 'Morgan Reyes', avatarUrl: null });
    // Removing someone keeps their membership row, marked removed.
    const membership = sql`workspace_id = ${workspaceId} AND user_id = ${people.admin.id}`;
    await db.execute(sql`UPDATE workspace_members SET removed_at = now() WHERE ${membership}`);
    try {
      const later = (await query(people.avery, { viewId: views.all!.id })).json();
      expect(later.people[people.admin.id]).toEqual({
        name: 'Morgan Reyes',
        avatarUrl: null,
        removed: true,
      });
      expect(later.people[people.avery.id]).toEqual({ name: 'Avery Lin', avatarUrl: null });
    } finally {
      await db.execute(sql`UPDATE workspace_members SET removed_at = NULL WHERE ${membership}`);
    }
  });

  it('answers only { blocked } for a view or override that uses a hidden property', async () => {
    const blocked = await query(people.jordan, { viewId: views.codes!.id });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json()).toEqual(BLOCKED);
    const sorted = await query(people.jordan, {
      viewId: views.all!.id,
      override: { sorts: [{ propertyId: props.code!.id, direction: 'desc' }] },
    });
    expect(sorted.json()).toEqual(BLOCKED);
    const avery = (await query(people.avery, { viewId: views.codes!.id })).json();
    expect(avery).not.toHaveProperty('blocked');
    expect(avery.count).toBeGreaterThan(1);
  });

  it('applies search and "Changed for you only" filters', async () => {
    const found = (await query(people.jordan, { viewId: views.all!.id, search: 'leak' })).json();
    expect(rowsOf(found).map((r: QueryRow) => r.id)).toEqual([ids.j2]);
    const filtered = (
      await query(people.jordan, {
        viewId: views.all!.id,
        override: {
          filter: {
            kind: 'group',
            id: 'f1',
            combinator: 'and',
            children: [
              {
                kind: 'condition',
                id: 'f2',
                propertyId: props.jobName!.id,
                op: 'contains',
                value: 'boiler',
              },
            ],
          },
        },
      })
    ).json();
    expect(rowsOf(filtered).map((r: QueryRow) => r.id)).toEqual([ids.j1]);
    expect(filtered.count).toBe(1);
  });

  it('finds a row by the text of its ID, prefix and number ("QA-5")', async () => {
    const jobId = newProperty('Job ID', { type: 'unique_id', prefix: 'QA' });
    const record = await loadDatabase(db, ids.jobs!);
    await changeDatabase(db, ids.jobs!, record!.version, (current) => ({
      properties: [...current.properties, jobId],
    }));
    await db.execute(sql`UPDATE db_rows SET unique_number = 4 WHERE page_id = ${ids.j1}`);
    await db.execute(sql`UPDATE db_rows SET unique_number = 5 WHERE page_id = ${ids.j2}`);
    const found = async (search: string) =>
      rowsOf((await query(people.jordan, { viewId: views.all!.id, search })).json()).map(
        (r: QueryRow) => r.id,
      );
    expect(await found('QA-5')).toEqual([ids.j2]);
    expect(await found('qa-4')).toEqual([ids.j1]);
    expect(await found('QA-7')).toEqual([]);
  });

  it('groups rows, and sub-groups them on boards', async () => {
    const grouped = (await query(people.jordan, { viewId: views.grouped!.id })).json();
    expect(grouped.rows).toEqual([]);
    const booked = grouped.groups.find((g: { label: string }) => g.label === 'Booked');
    const done = grouped.groups.find((g: { label: string }) => g.label === 'Done');
    expect(booked).toMatchObject({ count: 1 });
    expect(booked.rows.map((r: QueryRow) => r.id)).toEqual([ids.j1]);
    expect(done.rows.map((r: QueryRow) => r.id)).toEqual([ids.j2]);

    const board = (await query(people.jordan, { viewId: views.board!.id })).json();
    expect(board.lanes).toHaveLength(2);
    const column = board.groups.find((g: { label: string }) => g.label === 'Booked');
    expect(column.subGroups).toHaveLength(2);
    const lanes = column.subGroups.filter((s: { count: number }) => s.count > 0);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].rows.map((r: QueryRow) => r.id)).toEqual([ids.j1]);
  });

  it('pages with cursors and emits databases.database.viewed on a first page only', async () => {
    const visits = await newDatabase('Visits');
    const list = { ...defaultView('table', [visits.name]), loadLimit: 10 as const };
    list.sorts = [{ propertyId: visits.name.id, direction: 'asc' }];
    await setSchema(visits.id, [], [list]);
    for (let i = 1; i <= 12; i++)
      await addRow(visits.id, `Visit ${String(i).padStart(2, '0')}`, {});
    const seen: unknown[] = [];
    const off = app.events.on('databases.database.viewed', (event) => {
      seen.push(event);
    });
    try {
      const first = (await query(people.jordan, { viewId: list.id }, visits.id)).json();
      expect(first.rows).toHaveLength(10);
      expect(first.count).toBe(12);
      expect(typeof first.nextCursor).toBe('string');
      const rest = (
        await query(people.jordan, { viewId: list.id, cursor: first.nextCursor }, visits.id)
      ).json();
      expect(rest.rows.map((r: QueryRow) => r.title)).toEqual(['Visit 11', 'Visit 12']);
      expect(rest).toMatchObject({ continued: true, nextCursor: null });
      await app.events.settled();
      expect(seen).toEqual([
        { workspaceId, databaseId: visits.id, viewId: list.id, userId: people.jordan.id },
      ]);
    } finally {
      off();
    }
  });

  it('shows sub-items under their parents', async () => {
    const parent = newProperty('Parent item', { ...relationConfig(ids.jobs!), single: true });
    const children = newProperty('Sub-items', relationConfig(ids.jobs!));
    parent.config = { ...parent.config, twoWayPropertyId: children.id };
    children.config = { ...children.config, twoWayPropertyId: parent.id };
    const record = await loadDatabase(db, ids.jobs!);
    await changeDatabase(db, ids.jobs!, record!.version, (current) => ({
      properties: [...current.properties, parent, children],
      subItems: { parentPropertyId: parent.id, childrenPropertyId: children.id },
    }));
    const valve = await addRow(ids.jobs!, 'Fit valve', { [parent.id]: [ids.j2] });
    await db.execute(sql`
      UPDATE db_rows SET "values" = "values" || ${JSON.stringify({ [children.id]: [valve] })}::jsonb
      WHERE page_id = ${ids.j2}`);
    const body = (await query(people.jordan, { viewId: views.all!.id })).json();
    expect(rowsOf(body).map((r: QueryRow) => [r.title, r.depth, r.parentId ?? null])).toEqual([
      ['Boiler check', 0, null],
      ['Leak fix', 0, null],
      ['Fit valve', 1, ids.j2],
    ]);
  });

  it('refuses bad bodies, unknown views and pages that aren’t databases', async () => {
    expect((await query(people.jordan, {})).json()).toEqual(INVALID);
    const extra = await query(people.jordan, { viewId: views.all!.id, color: 'red' });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual(INVALID);
    const long = await query(people.jordan, { viewId: views.all!.id, search: 'x'.repeat(501) });
    expect(long.json()).toEqual(INVALID);
    const missing = await query(people.jordan, { viewId: newId() });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual(NOT_FOUND);
    const notDatabase = await query(people.jordan, { viewId: views.all!.id }, pageId);
    expect(notDatabase.statusCode).toBe(404);
    expect(notDatabase.json()).toEqual(NOT_FOUND);
  });

  it('runs two of one person’s view queries at once, and refuses a third with 429', async () => {
    const body = { viewId: views.all!.id };
    /** Queries of this test's database waiting for a lock. */
    const waiting = async () => {
      const { rows } = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      return rows[0]!.n;
    };
    let held: ReturnType<typeof query>[] = [];
    // The rows are locked, so Avery's first two queries wait inside the limit until the commit.
    await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE db_rows IN ACCESS EXCLUSIVE MODE`);
      held = [query(people.avery, body), query(people.avery, body)];
      for (const end = Date.now() + 4000; (await waiting()) < 2;) {
        if (Date.now() > end) throw new Error('the two queries never waited for the rows');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const third = await query(people.avery, body);
      expect(third.statusCode).toBe(429);
      expect(third.json()).toEqual({ error: { code: 'rate_limited', message: BUSY_MESSAGE } });
    });
    expect((await Promise.all(held)).map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await query(people.avery, body)).statusCode).toBe(200);
  });
});
