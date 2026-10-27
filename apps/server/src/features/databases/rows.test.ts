// Row routes on a real database (decision 0200): adding rows (template, view filter, group, ID
// numbers), reading them as each person may see them, changing and renaming them with history,
// relations kept in step on both sides with the links a person can't open kept, Trash and Undo,
// bulk changes, row access rules with a rows-only share, and what each write announces after its
// commit: events, live nudges and Person notices. Fictional people only.
import {
  defaultConfig,
  newId,
  newProperty,
  relationConfig,
  type FilterGroup,
  type Property,
  type RowTemplate,
  type SelectOption,
  type View,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { liveHub } from '../live';
import { testSink } from '../live/domain/testSink';
import { bindMemoryNotices } from '../notices/testing';
import { onDatabaseEvent, type DatabaseEvent } from './events';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { ROW_NOTICES } from './rows';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const invalid = (message: string) => ({ error: { code: 'invalid', message } });
const INVALID = invalid("That request isn't valid.");
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};

describe.skipIf(!hasDatabase)('row routes', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let stopEvents: () => void = () => undefined;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let jobsId: string;
  let clientsId: string;
  let nameId: string;
  const people = {} as Record<'admin' | 'avery' | 'jordan' | 'casey', TestUser>;
  const ids = {} as Record<'leak' | 'heater' | 'empty' | 'harbor' | 'pine', string>;
  const events: DatabaseEvent[] = [];
  const committed: boolean[] = [];

  // Jobs' properties (the ones that name people are made once the people exist).
  const high = newId();
  const low = newId();
  const options: SelectOption[] = [
    { id: high, name: 'High', color: 'red' },
    { id: low, name: 'Low', color: 'blue' },
  ];
  const priority = newProperty('Priority', { ...defaultConfig('select'), options });
  const hours = newProperty('Hours', defaultConfig('number'));
  const assignee = newProperty('Assignee', defaultConfig('person'));
  const ticket = newProperty('Ticket', defaultConfig('unique_id'));
  let gate: Property;
  let rate: Property;
  // The two-way relation between Jobs (Client) and Clients (Jobs).
  const clientId = newId();
  const jobsBackId = newId();
  let client: Property;
  let jobsBack: Property;

  // Stand-ins for the roles pull request's tables (decision 0007 names) until it lands.
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

  /** A workspace member with this role; in the Operations space unless `inSpace` is false. */
  async function person(role: Role, name: string, inSpace = true): Promise<TestUser> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${name}`}, ${`{${PERMISSIONS[role].join(',')}}`}::text[])
      RETURNING id`);
    const user = await createUser(db, { name });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role_id)
      VALUES (${workspaceId}, ${user.id}, ${rows[0]!.id})`);
    if (inSpace) {
      await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
        VALUES (${spaceId}, 'user', ${user.id})`);
    }
    return user;
  }

  async function newDatabase(title: string): Promise<string> {
    const res = await injectAs(app, people.admin, {
      method: 'POST',
      url: '/api/databases',
      payload: { parentId: pageId, inline: false, title },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  /** A settings write at the database's current version. */
  async function settings(
    id: string,
    change: (current: DatabaseRecord) => Partial<DatabaseSettings>,
  ): Promise<DatabaseRecord> {
    const current = await loadDatabase(db, id);
    if (!current) throw new Error('The test database is missing.');
    return changeDatabase(db, id, current.version, change);
  }

  async function storedValues(rowId: string): Promise<Record<string, unknown>> {
    const { rows } = await db.execute<{ values: Record<string, unknown> }>(
      sql`SELECT "values" FROM db_rows WHERE page_id = ${rowId}`,
    );
    return rows[0]?.values ?? {};
  }

  const noticesFor = (who: TestUser) => notices.store.records.filter((n) => n.userId === who.id);

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    notices = bindMemoryNotices();
    stopEvents = onDatabaseEvent(app, async (event) => {
      events.push(event);
      if (event.name !== 'databases.row.created') return;
      const { rows } = await db.execute(
        sql`SELECT 1 FROM db_rows WHERE page_id = ${event.payload.rowId}`,
      );
      committed.push(rows.length === 1);
    });
    await standInWorkspace();
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Call-outs', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.admin = await person('admin', 'Morgan Reyes');
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');
    people.casey = await person('editor', 'Casey Brooks', false);

    jobsId = await newDatabase('Jobs');
    clientsId = await newDatabase('Clients');
    gate = {
      ...newProperty('Gate code', defaultConfig('text')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    rate = {
      ...newProperty('Rate', defaultConfig('number')),
      access: { see: null, change: [{ type: 'user', id: people.avery.id }] },
    };
    client = {
      ...newProperty('Client', { ...relationConfig(clientsId), twoWayPropertyId: jobsBackId }),
      id: clientId,
    };
    jobsBack = {
      ...newProperty('Jobs', { ...relationConfig(jobsId), twoWayPropertyId: clientId }),
      id: jobsBackId,
    };
    const jobs = await settings(jobsId, (current) => ({
      properties: [...current.properties, priority, hours, gate, rate, assignee, ticket, client],
    }));
    nameId = jobs.properties.find((p) => p.config.type === 'title')!.id;
    await settings(clientsId, (current) => ({ properties: [...current.properties, jobsBack] }));
  });

  afterAll(async () => {
    stopEvents();
    notices?.unbind();
    await close?.();
  });

  const call = (who: TestUser, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object) =>
    injectAs(app, who, { method, url: `/api/databases/${path}`, payload });
  const addRow = (who: TestUser, payload: object, databaseId = jobsId) =>
    call(who, 'POST', `${databaseId}/rows`, payload);
  const getRow = (who: TestUser, rowId: string, databaseId = jobsId) =>
    call(who, 'GET', `${databaseId}/rows/${rowId}`);
  const patchRow = (who: TestUser, rowId: string, values: object, databaseId = jobsId) =>
    call(who, 'PATCH', `${databaseId}/rows/${rowId}`, { values });
  const rowsAction = (who: TestUser, action: 'bulk' | 'trash' | 'restore', payload: object) =>
    call(who, 'POST', `${jobsId}/rows/${action}`, payload);

  it('adds a row with its title, its values and the next ID number', async () => {
    const res = await addRow(people.avery, {
      title: '  Leaking pipe ',
      values: { [hours.id]: '3', [priority.id]: high },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    ids.leak = body.id;
    expect(body).toMatchObject({
      databaseId: jobsId,
      title: 'Leaking pipe',
      uniqueNumber: 1,
      createdBy: people.avery.id,
      editedBy: people.avery.id,
      viewerAccess: 'edit',
      values: { [hours.id]: '3', [priority.id]: high },
      hiddenLinks: {},
    });
    const { rows } = await db.execute<{ kind: string; parent_id: string; title: string }>(
      sql`SELECT kind, parent_id, title FROM pages WHERE id = ${ids.leak}`,
    );
    expect(rows[0]).toEqual({ kind: 'row', parent_id: jobsId, title: 'Leaking pipe' });
  });

  it('starts from the default template, the view’s filter and the group it was added in', async () => {
    const template: RowTemplate = {
      id: newId(),
      name: 'Call-out',
      icon: null,
      values: { [hours.id]: '1', [priority.id]: high },
    };
    const filter: FilterGroup = {
      kind: 'group',
      id: newId(),
      combinator: 'and',
      children: [
        { kind: 'condition', id: newId(), propertyId: priority.id, op: 'is', value: [low] },
      ],
    };
    const saved = await settings(jobsId, (current) => ({
      templates: [template],
      defaultTemplateId: template.id,
      views: current.views.map((view): View => ({
        ...view,
        filter,
        grouping: { propertyId: assignee.id },
      })),
    }));
    const viewId = saved.views[0]!.id;

    const res = await addRow(people.avery, { viewId, groupKey: people.jordan.id });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    ids.heater = body.id;
    expect(body).toMatchObject({ title: '', uniqueNumber: 2 });
    expect(body.values).toEqual({
      [hours.id]: '1',
      [priority.id]: low,
      [assignee.id]: [people.jordan.id],
    });

    const empty = await addRow(people.avery, { templateId: null });
    expect(empty.statusCode).toBe(201);
    ids.empty = empty.json().id;
    expect(empty.json()).toMatchObject({ title: '', uniqueNumber: 3 });
    expect(empty.json().values).toEqual({});

    // Jordan was put in the Assignee group: one notice, with the row only on its card.
    expect(noticesFor(people.jordan)).toEqual([
      expect.objectContaining({
        workspaceId,
        kind: 'alert',
        sender: ROW_NOTICES.sender,
        title: ROW_NOTICES.addedToRow,
        card: { type: 'page', pageId: ids.heater },
      }),
    ]);
    expect(noticesFor(people.avery)).toEqual([]);
  });

  it('shows each person only the properties they can see, and never writes the others', async () => {
    const set = await patchRow(people.avery, ids.leak, { [gate.id]: '4821' });
    expect(set.statusCode).toBe(200);
    expect(set.json().values[gate.id]).toEqual([{ text: '4821' }]);

    const jordan = await getRow(people.jordan, ids.leak);
    expect(jordan.statusCode).toBe(200);
    expect(jordan.json()).toMatchObject({ id: ids.leak, viewerAccess: 'view' });
    expect(Object.keys(jordan.json().values)).not.toContain(gate.id);

    // Morgan can't see the gate code: that value is left out without a word.
    const admin = await patchRow(people.admin, ids.leak, { [gate.id]: '0000', [hours.id]: '4' });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().values).not.toHaveProperty(gate.id);
    expect(admin.json().values[hours.id]).toBe('4');
    const avery = (await getRow(people.avery, ids.leak)).json();
    expect(avery.values[gate.id]).toEqual([{ text: '4821' }]);
    expect(avery.values[hours.id]).toBe('4');

    // Rate's change list names Avery only.
    const refused = await patchRow(people.admin, ids.leak, { [rate.id]: '80' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual(FORBIDDEN);
    const rated = await patchRow(people.avery, ids.leak, { [rate.id]: '95' });
    expect(rated.json().values[rate.id]).toBe('95');
  });

  it('renames a row with the Name property and keeps one history entry per change', async () => {
    const res = await patchRow(people.avery, ids.heater, {
      [nameId]: 'Water heater',
      [hours.id]: '2',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Water heater', values: { [hours.id]: '2' } });
    expect((await getRow(people.jordan, ids.heater)).json().title).toBe('Water heater');

    // The same values again change nothing.
    await patchRow(people.avery, ids.heater, { [nameId]: 'Water heater', [hours.id]: '2' });
    const { rows } = await db.execute<{ property_id: string; before: unknown; after: unknown }>(
      sql`SELECT property_id, "before", "after", "by" FROM db_row_changes
        WHERE row_id = ${ids.heater}`,
    );
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { property_id: nameId, before: '', after: 'Water heater', by: people.avery.id },
        { property_id: hours.id, before: '1', after: '2', by: people.avery.id },
      ]),
    );
  });

  it('answers 400, 403 and 404 with their messages', async () => {
    const number = await patchRow(people.avery, ids.leak, { [hours.id]: 'lots' });
    expect(number.statusCode).toBe(400);
    expect(number.json()).toEqual(invalid('Enter a number.'));
    const option = await addRow(people.avery, { values: { [priority.id]: newId() } });
    expect(option.json()).toEqual(invalid("That option doesn't exist."));
    const automatic = await patchRow(people.avery, ids.leak, { [ticket.id]: 7 });
    expect(automatic.statusCode).toBe(400);
    expect(automatic.json()).toEqual(invalid("This property can't be edited."));

    const viewer = await patchRow(people.jordan, ids.leak, { [hours.id]: '5' });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual(FORBIDDEN);
    expect((await addRow(people.jordan, { title: 'Blocked drain' })).json()).toEqual(FORBIDDEN);

    const url = `${jobsId}/rows/${ids.leak}`;
    expect((await call(people.avery, 'PATCH', url, { values: {}, color: 'red' })).json()).toEqual(
      INVALID,
    );
    expect((await call(people.avery, 'PATCH', url, {})).statusCode).toBe(400);
    expect((await addRow(people.avery, { templateId: newId() })).json()).toEqual(INVALID);
    expect((await addRow(people.avery, { viewId: newId() })).json()).toEqual(INVALID);
    expect((await addRow(people.avery, { title: 'x'.repeat(2001) })).json()).toEqual(INVALID);

    const missing = await getRow(people.avery, newId());
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual(NOT_FOUND);
    expect((await getRow(people.avery, 'not-an-id')).statusCode).toBe(404);
    expect((await getRow(people.avery, ids.leak, clientsId)).statusCode).toBe(404);
    expect((await getRow(people.avery, jobsId)).statusCode).toBe(404);
    // Nothing above took an ID number.
    const next = await addRow(people.avery, { title: 'Blocked drain' });
    expect(next.json().uniqueNumber).toBe(4);
    await rowsAction(people.avery, 'trash', { rowIds: [next.json().id] });
  });

  it('keeps two-way relations in step, and keeps the links a person can’t open', async () => {
    ids.harbor = (await addRow(people.admin, { title: 'Harbor Dental' }, clientsId)).json().id;
    ids.pine = (await addRow(people.admin, { title: 'Blue Pine Plumbing' }, clientsId)).json().id;
    // Only Morgan (an admin) can open Blue Pine Plumbing.
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${ids.pine}`);

    const linked = await patchRow(people.admin, ids.leak, { [client.id]: [ids.harbor, ids.pine] });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().values[client.id]).toEqual([ids.harbor, ids.pine]);
    const pine = await getRow(people.admin, ids.pine, clientsId);
    expect(pine.json().values[jobsBack.id]).toEqual([ids.leak]);

    const avery = (await getRow(people.avery, ids.leak)).json();
    expect(avery.values[client.id]).toEqual([ids.harbor]);
    expect(avery.hiddenLinks).toEqual({ [client.id]: 1 });
    expect(avery.rowTitles).toEqual({ [ids.harbor]: 'Harbor Dental' });
    expect((await getRow(people.avery, ids.pine, clientsId)).statusCode).toBe(403);

    // Avery clears the links she sees; the one she can't open stays.
    const cleared = await patchRow(people.avery, ids.leak, { [client.id]: [] });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().values).not.toHaveProperty(client.id);
    expect(cleared.json().hiddenLinks).toEqual({ [client.id]: 1 });
    expect((await storedValues(ids.leak))[client.id]).toEqual([ids.pine]);
    expect(await storedValues(ids.harbor)).not.toHaveProperty(jobsBack.id);
    expect((await storedValues(ids.pine))[jobsBack.id]).toEqual([ids.leak]);

    // Links must be rows of the related database that she can open.
    for (const links of [[ids.pine], [newId()], [ids.heater]]) {
      const res = await patchRow(people.avery, ids.leak, { [client.id]: links });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(INVALID);
    }

    // From the other side.
    const back = await patchRow(
      people.avery,
      ids.harbor,
      { [jobsBack.id]: [ids.heater] },
      clientsId,
    );
    expect(back.statusCode).toBe(200);
    const heater = (await getRow(people.avery, ids.heater)).json();
    expect(heater.values[client.id]).toEqual([ids.harbor]);
    expect(heater.rowTitles).toEqual({ [ids.harbor]: 'Harbor Dental' });
  });

  it('moves rows to Trash and back, and leaves rows in Trash out of relations', async () => {
    const trashed = await rowsAction(people.avery, 'trash', { rowIds: [ids.heater] });
    expect(trashed.statusCode).toBe(200);
    expect(trashed.json()).toEqual({ rowIds: [ids.heater] });
    const gone = await getRow(people.avery, ids.heater);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual(NOT_FOUND);
    const harbor = (await getRow(people.avery, ids.harbor, clientsId)).json();
    expect(harbor.values).not.toHaveProperty(jobsBack.id);
    expect(harbor.hiddenLinks).toEqual({});

    expect((await rowsAction(people.avery, 'trash', { rowIds: [ids.heater] })).statusCode).toBe(
      404,
    );
    expect((await rowsAction(people.avery, 'trash', { rowIds: [newId()] })).json()).toEqual(
      NOT_FOUND,
    );
    expect((await rowsAction(people.jordan, 'trash', { rowIds: [ids.leak] })).json()).toEqual(
      FORBIDDEN,
    );
    expect((await rowsAction(people.jordan, 'restore', { rowIds: [ids.heater] })).json()).toEqual(
      FORBIDDEN,
    );
    expect((await rowsAction(people.avery, 'restore', { rowIds: [ids.leak] })).statusCode).toBe(
      404,
    );

    const restored = await rowsAction(people.avery, 'restore', { rowIds: [ids.heater] });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({ rowIds: [ids.heater] });
    expect((await getRow(people.avery, ids.heater)).statusCode).toBe(200);
    const linked = (await getRow(people.avery, ids.harbor, clientsId)).json();
    expect(linked.values[jobsBack.id]).toEqual([ids.heater]);
  });

  it('changes many rows at once, and tells each person added once', async () => {
    const rowIds = [ids.leak, ids.heater, ids.empty];
    const values = { [priority.id]: low, [assignee.id]: [people.admin.id] };
    const res = await rowsAction(people.avery, 'bulk', { rowIds, values });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rowIds });
    expect((await rowsAction(people.avery, 'bulk', { rowIds, values })).json()).toEqual({
      rowIds: [],
    });
    expect(noticesFor(people.admin)).toEqual([
      expect.objectContaining({
        title: ROW_NOTICES.addedToRows(3),
        card: { type: 'page', pageId: jobsId },
      }),
    ]);

    const tooMany = Array.from({ length: 501 }, () => newId());
    expect((await rowsAction(people.avery, 'bulk', { rowIds: tooMany, values })).json()).toEqual(
      INVALID,
    );
    expect((await rowsAction(people.avery, 'bulk', { rowIds: [], values })).statusCode).toBe(400);
    expect((await rowsAction(people.jordan, 'bulk', { rowIds, values })).json()).toEqual(FORBIDDEN);
    const unknown = await rowsAction(people.avery, 'bulk', { rowIds: [ids.leak, newId()], values });
    expect(unknown.json()).toEqual(NOT_FOUND);
  });

  it('nudges the database’s live topic after each write', async () => {
    const topic = `db:${jobsId}`;
    const sink = testSink();
    const tab = liveHub.connect(people.jordan.id, sink.sink);
    const outsider = liveHub.connect(people.casey.id, testSink().sink);
    try {
      const subscribed = await liveHub.updateTopics({
        userId: people.jordan.id,
        connectionId: tab.id,
        add: [topic, `db:${ids.leak}`, 'db:not-a-database'],
      });
      expect(subscribed?.results).toEqual([
        { topic, ok: true },
        { topic: `db:${ids.leak}`, ok: false },
        { topic: 'db:not-a-database', ok: false },
      ]);
      const refused = await liveHub.updateTopics({
        userId: people.casey.id,
        connectionId: outsider.id,
        add: [topic],
      });
      expect(refused?.results).toEqual([{ topic, ok: false }]);

      await patchRow(people.avery, ids.leak, { [hours.id]: '6' });
      await rowsAction(people.avery, 'trash', { rowIds: [ids.empty] });
      expect(sink.events().map((frame) => frame.data)).toEqual([
        { topic, type: 'rows-changed', data: { rowIds: [ids.leak] } },
        { topic, type: 'rows-changed', data: { rowIds: [ids.empty] } },
      ]);
    } finally {
      tab.disconnect();
      outsider.disconnect();
    }
  });

  it('sends events after the commit, with ids and small facts only', async () => {
    await app.events.settled();
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every(Boolean)).toBe(true);
    expect(events).toContainEqual({
      name: 'databases.row.created',
      payload: {
        workspaceId,
        databaseId: jobsId,
        rowId: ids.leak,
        actorId: people.avery.id,
        source: 'user',
      },
    });
    expect(events).toContainEqual({
      name: 'databases.row.updated',
      payload: {
        workspaceId,
        databaseId: jobsId,
        rowId: ids.heater,
        actorId: people.avery.id,
        propertyIds: expect.arrayContaining([nameId, hours.id]),
        source: 'user',
      },
    });
    // The other side of a two-way relation changes too.
    expect(events).toContainEqual({
      name: 'databases.row.updated',
      payload: {
        workspaceId,
        databaseId: clientsId,
        rowId: ids.pine,
        actorId: people.admin.id,
        propertyIds: [jobsBack.id],
        source: 'user',
      },
    });
    for (const name of ['databases.row.trashed', 'databases.row.restored'] as const) {
      expect(events).toContainEqual({
        name,
        payload: {
          workspaceId,
          databaseId: jobsId,
          rowIds: [ids.heater],
          actorId: people.avery.id,
        },
      });
    }
  });

  it('opens rows to a rows-only share through row access rules', async () => {
    // Before Casey has any access, adding her sends no notice.
    await patchRow(people.avery, ids.leak, { [assignee.id]: [people.casey.id] });
    expect(noticesFor(people.casey)).toEqual([]);
    expect((await getRow(people.casey, ids.leak)).statusCode).toBe(403);

    await settings(jobsId, () => ({
      accessRules: [{ id: newId(), propertyId: assignee.id, level: 'edit' }],
    }));
    await db.execute(sql`INSERT INTO access_grants
      (workspace_id, page_id, principal_type, principal_id, level)
      VALUES (${workspaceId}, ${jobsId}, 'user', ${people.casey.id}, 'rows_only')`);

    const mine = await getRow(people.casey, ids.leak);
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ id: ids.leak, viewerAccess: 'edit' });
    const other = await getRow(people.casey, ids.heater);
    expect(other.statusCode).toBe(403);
    expect(other.json()).toEqual(FORBIDDEN);
    const edited = await patchRow(people.casey, ids.leak, { [hours.id]: '7' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().values[hours.id]).toBe('7');
    expect((await addRow(people.casey, { title: 'Frozen pipe' })).json()).toEqual(FORBIDDEN);

    // She hears the database's nudges, without row ids: rules decide which rows each person sees.
    const topic = `db:${jobsId}`;
    const sink = testSink();
    const tab = liveHub.connect(people.casey.id, sink.sink);
    try {
      const subscribed = await liveHub.updateTopics({
        userId: people.casey.id,
        connectionId: tab.id,
        add: [topic],
      });
      expect(subscribed?.results).toEqual([{ topic, ok: true }]);
      const added = [people.admin.id, people.casey.id];
      await patchRow(people.avery, ids.heater, { [assignee.id]: added });
      expect(sink.events().map((frame) => frame.data)).toEqual([{ topic, type: 'rows-changed' }]);
    } finally {
      tab.disconnect();
    }
    // Now that a rule opens the row to her, she's told.
    expect(noticesFor(people.casey)).toEqual([
      expect.objectContaining({
        title: ROW_NOTICES.addedToRow,
        card: { type: 'page', pageId: ids.heater },
      }),
    ]);
    expect((await getRow(people.casey, ids.heater)).json().viewerAccess).toBe('edit');
  });
});
