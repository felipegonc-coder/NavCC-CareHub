// Server functions for other lanes (decision 0200, api.ts) on a real database: row writes in the
// caller's transaction, announced after its commit, each in a savepoint so a refusal leaves the
// transaction usable; anonymous form answers; imports; reads as each person may see them; and the
// Team tools calendar's database layers. Fictional people only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  relationConfig,
  type FilterGroup,
  type Property,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Tx } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { bindMemoryNotices } from '../notices/testing';
import {
  createRow,
  createRows,
  findRowIds,
  listDatedRows,
  listDateSources,
  onDatabaseEvent,
  readRow,
  readRowText,
  restoreRows,
  runRowWrites,
  setRowDate,
  trashRows,
  updateRows,
  type CalendarViewer,
  type DatabaseEvent,
  type DatedRowsQuery,
  type RowDatePatch,
} from './api';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { ROW_NOTICES } from './rows';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const NOT_RUN_BY_RUN_ROW_WRITES = 'Row writes need the transaction that runRowWrites passes in.';

describe.skipIf(!hasDatabase)('database server functions', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let stopEvents: () => void = () => undefined;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let visitsId: string;
  let clientsId: string;
  let nameId: string;
  let clientNameId: string;
  let formViewId: string;
  let imported: string[] = [];
  const people = {} as Record<'admin' | 'avery' | 'jordan' | 'casey', TestUser>;
  const ids = {} as Record<'leak' | 'heater' | 'tap' | 'frozen' | 'harbor', string>;
  const events: DatabaseEvent[] = [];
  const committed: boolean[] = [];

  // Visits' properties (the ones only Avery sees are made once Avery exists).
  const visit = newProperty('Visit', defaultConfig('date'));
  const hours = newProperty('Hours', defaultConfig('number'));
  const assignee = newProperty('Assignee', defaultConfig('person'));
  const ticket = newProperty('Ticket', defaultConfig('unique_id'));
  let followUp: Property;
  let gate: Property;
  let rate: Property;
  let client: Property;

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

  async function stored(rowId: string) {
    const { rows } = await db.execute<{ title: string; values: Record<string, unknown> }>(sql`
      SELECT p.title, r."values" FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.page_id = ${rowId}`);
    return rows[0];
  }

  /** The events sent since there were `count`, once their handlers have run. */
  async function eventsSince(count: number): Promise<DatabaseEvent[]> {
    await app.events.settled();
    return events.slice(count);
  }

  const write = <T>(work: (tx: Tx) => Promise<T>) => runRowWrites(app, work);
  const viewerOf = (who: TestUser): CalendarViewer => ({ userId: who.id, workspaceId });
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
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.admin = await person('admin', 'Morgan Reyes');
    people.avery = await person('editor', 'Avery Lin');
    people.jordan = await person('viewer', 'Jordan Park');
    people.casey = await person('editor', 'Casey Brooks', false);
    await db.execute(
      sql`UPDATE users SET time_zone = 'America/Chicago' WHERE id = ${people.jordan.id}`,
    );
    await db.execute(sql`UPDATE users SET time_zone = 'Europe/London', use_24h = true
      WHERE id = ${people.avery.id}`);

    visitsId = await newDatabase('Visits');
    clientsId = await newDatabase('Clients');
    followUp = {
      ...newProperty('Follow-up', defaultConfig('date')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    gate = {
      ...newProperty('Gate code', defaultConfig('text')),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    };
    rate = {
      ...newProperty('Rate', defaultConfig('number')),
      access: { see: null, change: [{ type: 'user', id: people.avery.id }] },
    };
    client = newProperty('Client', relationConfig(clientsId));
    const visits = await settings(visitsId, (current) => {
      const properties = [...current.properties, visit, followUp, hours, gate, rate, assignee];
      const form = defaultView('form', properties, { name: 'Call-out request' });
      return { properties: [...properties, ticket, client], views: [...current.views, form] };
    });
    nameId = visits.properties.find((p) => p.config.type === 'title')!.id;
    formViewId = visits.views.find((v) => v.layout === 'form')!.id;
    const clients = await loadDatabase(db, clientsId);
    clientNameId = clients!.properties.find((p) => p.config.type === 'title')!.id;
  });

  afterAll(async () => {
    stopEvents();
    notices?.unbind();
    await close?.();
  });

  it('writes in the caller’s transaction and announces it after the commit', async () => {
    const before = events.length;
    const { rowId } = await write(async (tx) => {
      const made = await createRow(tx, {
        databaseId: visitsId,
        values: { [nameId]: 'Leaking pipe', [hours.id]: '3', [assignee.id]: [people.jordan.id] },
        actorUserId: people.avery.id,
        source: 'automation',
      });
      // Nothing is announced before the commit.
      await app.events.settled();
      expect(events.length).toBe(before);
      expect(noticesFor(people.jordan)).toEqual([]);
      return made;
    });
    ids.leak = rowId;
    expect(await eventsSince(before)).toEqual([
      {
        name: 'databases.row.created',
        payload: {
          workspaceId,
          databaseId: visitsId,
          rowId,
          actorId: people.avery.id,
          source: 'automation',
        },
      },
    ]);
    expect(committed).toEqual([true]);
    expect(noticesFor(people.jordan)).toEqual([
      expect.objectContaining({
        title: ROW_NOTICES.addedToRow,
        card: { type: 'page', pageId: rowId },
      }),
    ]);
    const row = await stored(rowId);
    expect(row?.title).toBe('Leaking pipe');
    expect(row?.values).toMatchObject({ [hours.id]: '3', [assignee.id]: [people.jordan.id] });

    // Row writes only run in runRowWrites' transaction.
    await expect(
      db.transaction((tx) =>
        createRow(tx, { databaseId: visitsId, actorUserId: people.avery.id, source: 'user' }),
      ),
    ).rejects.toThrow(NOT_RUN_BY_RUN_ROW_WRITES);
  });

  it('leaves the transaction usable after a refusal, and announces nothing when work fails', async () => {
    const before = events.length;
    const { rowId } = await write(async (tx) => {
      await expect(
        createRow(tx, { databaseId: visitsId, actorUserId: people.jordan.id, source: 'user' }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        createRow(tx, { databaseId: newId(), actorUserId: people.avery.id, source: 'user' }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        createRow(tx, {
          databaseId: visitsId,
          values: { [hours.id]: 'lots' },
          actorUserId: people.avery.id,
          source: 'user',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        updateRows(tx, {
          databaseId: visitsId,
          rowIds: [newId()],
          values: { [hours.id]: '1' },
          actorUserId: people.avery.id,
          source: 'button',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      return createRow(tx, {
        databaseId: visitsId,
        values: { [nameId]: 'Water heater' },
        actorUserId: people.avery.id,
        source: 'user',
      });
    });
    ids.heater = rowId;
    expect((await eventsSince(before)).map((e) => e.name)).toEqual(['databases.row.created']);
    // The refused rows took no ID number.
    const { rows } = await db.execute<{ unique_number: number }>(
      sql`SELECT unique_number FROM db_rows WHERE page_id = ${rowId}`,
    );
    expect(rows[0]?.unique_number).toBe(2);

    const count = events.length;
    let lost = '';
    await expect(
      write(async (tx) => {
        ({ rowId: lost } = await createRow(tx, {
          databaseId: visitsId,
          values: { [nameId]: 'Never saved' },
          actorUserId: people.avery.id,
          source: 'user',
        }));
        throw new Error('The automation stopped.');
      }),
    ).rejects.toThrow('The automation stopped.');
    expect(await eventsSince(count)).toEqual([]);
    expect(lost).not.toBe('');
    expect(await stored(lost)).toBeUndefined();
  });

  it('saves form answers from anyone the form lets in, anonymous or not', async () => {
    ({ rowId: ids.harbor } = await write((tx) =>
      createRow(tx, {
        databaseId: clientsId,
        values: { [clientNameId]: 'Harbor Dental' },
        actorUserId: people.avery.id,
        source: 'user',
      }),
    ));
    const before = events.length;
    // An anonymous answer. It links a row (the forms server checked the respondent can open it),
    // and writes properties whose access lists leave the respondent out: the form decides.
    const answered = {
      [nameId]: 'Dripping tap',
      [hours.id]: '1',
      [gate.id]: '7310',
      [rate.id]: '95',
      [client.id]: [ids.harbor],
    };
    const { rowId } = await write((tx) =>
      createRow(tx, {
        databaseId: visitsId,
        templateId: null,
        values: answered,
        actorUserId: null,
        source: 'form',
        formId: formViewId,
      }),
    );
    ids.tap = rowId;
    // Casey can't open Visits, but the form let her answer.
    const responseId = newId();
    ({ rowId: ids.frozen } = await write((tx) =>
      createRow(tx, {
        databaseId: visitsId,
        templateId: null,
        values: { [nameId]: 'Frozen pipe' },
        actorUserId: people.casey.id,
        source: 'form',
        formId: formViewId,
        responseId,
      }),
    ));
    const answer = { workspaceId, databaseId: visitsId, source: 'form', formId: formViewId };
    expect(await eventsSince(before)).toEqual([
      { name: 'databases.row.created', payload: { ...answer, rowId, actorId: null } },
      {
        name: 'databases.row.created',
        payload: { ...answer, rowId: ids.frozen, actorId: people.casey.id, responseId },
      },
    ]);
    const { rows } = await db.execute<{ form_view_id: string | null; created_by: string | null }>(
      sql`SELECT form_view_id, created_by FROM db_rows WHERE page_id IN (${rowId}, ${ids.frozen})
        ORDER BY unique_number`,
    );
    expect(rows).toEqual([
      { form_view_id: formViewId, created_by: null },
      { form_view_id: formViewId, created_by: people.casey.id },
    ]);
    expect((await stored(rowId))?.values).toMatchObject({
      [hours.id]: '1',
      [gate.id]: [{ text: '7310' }],
      [rate.id]: '95',
      [client.id]: [ids.harbor],
    });

    // A form answer names one of the database's form views; only form answers are anonymous;
    // only people write; links are to rows that are there; anyone else goes by the access lists.
    const tableViewId = (await loadDatabase(db, visitsId))!.views[0]!.id;
    const refusals: [Partial<Parameters<typeof createRow>[1]>, number][] = [
      [{ actorUserId: null, source: 'form' }, 400],
      [{ actorUserId: null, source: 'form', formId: tableViewId }, 400],
      [{ actorUserId: people.casey.id, source: 'form', formId: newId() }, 400],
      [
        {
          actorUserId: null,
          source: 'form',
          formId: formViewId,
          values: { [client.id]: [newId()] },
        },
        400,
      ],
      [{ actorUserId: null, source: 'user' }, 403],
      [{ actorUserId: people.casey.id, source: 'user' }, 403],
      [{ actorUserId: people.admin.id, source: 'user', values: { [rate.id]: '95' } }, 403],
      [{ actorUserId: newId(), source: 'automation' }, 403],
    ];
    for (const [change, status] of refusals) {
      await expect(
        write((tx) =>
          createRow(tx, { databaseId: visitsId, actorUserId: null, source: 'form', ...change }),
        ),
      ).rejects.toMatchObject({ statusCode: status });
    }
    await expect(
      write((tx) =>
        createRows(tx, {
          databaseId: visitsId,
          rows: [{}],
          actorUserId: people.avery.id,
          source: 'form',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('imports rows in order with consecutive ID numbers, marked with the import', async () => {
    const { rows: made } = await db.execute<{ id: string }>(sql`
      INSERT INTO db_imports (database_id, "by", status)
      VALUES (${visitsId}, ${people.avery.id}, 'running') RETURNING id`);
    const importId = made[0]!.id;
    const before = events.length;
    const told = notices.store.records.length;
    const { rowIds } = await write((tx) =>
      createRows(tx, {
        databaseId: visitsId,
        rows: [
          { values: { [nameId]: 'Harbor Dental', [assignee.id]: [people.jordan.id] } },
          { values: { [nameId]: 'Blue Pine office' } },
          {},
        ],
        actorUserId: people.avery.id,
        source: 'import',
        importId,
      }),
    );
    imported = rowIds;
    const { rows } = await db.execute<{ id: string; title: string; unique_number: number }>(sql`
      SELECT r.page_id AS id, p.title, r.unique_number FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.import_id = ${importId} ORDER BY r.unique_number`);
    expect(rows).toEqual([
      { id: rowIds[0], title: 'Harbor Dental', unique_number: 5 },
      { id: rowIds[1], title: 'Blue Pine office', unique_number: 6 },
      { id: rowIds[2], title: '', unique_number: 7 },
    ]);
    const sent = await eventsSince(before);
    expect(sent).toHaveLength(3);
    for (const event of sent) {
      expect(event).toMatchObject({ name: 'databases.row.created', payload: { source: 'import' } });
    }
    // An import doesn't tell the people it names.
    expect(notices.store.records).toHaveLength(told);

    // One refusal adds none of the rows, and the transaction goes on.
    const kept = await write(async (tx) => {
      await expect(
        createRows(tx, {
          databaseId: visitsId,
          rows: [{ values: { [nameId]: 'Kept?' } }, { values: { [hours.id]: 'lots' } }],
          actorUserId: people.avery.id,
          source: 'import',
          importId,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createRows(tx, {
          databaseId: visitsId,
          rows: [{}],
          actorUserId: people.jordan.id,
          source: 'import',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        createRows(tx, {
          databaseId: visitsId,
          rows: [{}],
          actorUserId: people.avery.id,
          source: 'import',
          importId: 'not-an-import',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      const { rows: found } = await tx.execute(
        sql`SELECT 1 FROM db_rows WHERE import_id = ${importId}`,
      );
      return found.length;
    });
    expect(kept).toBe(3);
  });

  it('changes, trashes and restores rows for buttons and automations', async () => {
    const before = events.length;
    const both = [ids.leak, ids.heater];
    const change = { databaseId: visitsId, rowIds: both, values: { [hours.id]: '2' } };
    const changed = await write((tx) =>
      updateRows(tx, { ...change, actorUserId: people.avery.id, source: 'button' }),
    );
    expect([...changed.rowIds].sort()).toEqual([...both].sort());
    const updated = await eventsSince(before);
    expect(updated).toHaveLength(2);
    for (const event of updated) {
      expect(event).toMatchObject({
        name: 'databases.row.updated',
        payload: {
          workspaceId,
          databaseId: visitsId,
          actorId: people.avery.id,
          propertyIds: [hours.id],
          source: 'button',
        },
      });
    }
    // The same values again change nothing, and say nothing.
    const again = await write((tx) =>
      updateRows(tx, { ...change, actorUserId: people.avery.id, source: 'button' }),
    );
    expect(again).toEqual({ rowIds: [] });
    expect(await eventsSince(before + 2)).toEqual([]);
    await expect(
      write((tx) => updateRows(tx, { ...change, actorUserId: people.jordan.id, source: 'user' })),
    ).rejects.toMatchObject({ statusCode: 403 });

    const move = { databaseId: visitsId, rowIds: [ids.tap], actorUserId: people.avery.id };
    expect(await write((tx) => trashRows(tx, move))).toEqual({ rowIds: [ids.tap] });
    await expect(readRow(db, { userId: people.avery.id, rowId: ids.tap })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      write((tx) => trashRows(tx, { ...move, actorUserId: people.jordan.id })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await write((tx) => restoreRows(tx, move))).toEqual({ rowIds: [ids.tap] });
    expect(await eventsSince(before + 2)).toEqual([
      {
        name: 'databases.row.trashed',
        payload: { workspaceId, databaseId: visitsId, rowIds: [ids.tap], actorId: people.avery.id },
      },
      {
        name: 'databases.row.restored',
        payload: { workspaceId, databaseId: visitsId, rowIds: [ids.tap], actorId: people.avery.id },
      },
    ]);
  });

  it('reads a row as that person may see it', async () => {
    await write((tx) =>
      updateRows(tx, {
        databaseId: visitsId,
        rowIds: [ids.leak],
        values: { [gate.id]: '4821', [client.id]: [ids.harbor] },
        actorUserId: people.avery.id,
        source: 'user',
      }),
    );
    const avery = await readRow(db, { userId: people.avery.id, rowId: ids.leak });
    expect(avery).toMatchObject({
      rowId: ids.leak,
      databaseId: visitsId,
      title: 'Leaking pipe',
      uniqueNumber: 1,
      createdBy: people.avery.id,
      editedBy: people.avery.id,
      access: 'edit',
    });
    expect(avery.values).toMatchObject({
      [hours.id]: '2',
      [assignee.id]: [people.jordan.id],
      [gate.id]: [{ text: '4821' }],
      [client.id]: [ids.harbor],
    });

    const jordan = await readRow(db, { userId: people.jordan.id, rowId: ids.leak });
    expect(jordan.access).toBe('view');
    expect(Object.keys(jordan.values)).not.toContain(gate.id);
    expect(jordan.values).toMatchObject({
      [assignee.id]: [people.jordan.id],
      [client.id]: [ids.harbor],
    });

    // A linked row in Trash drops out.
    const harbor = { databaseId: clientsId, rowIds: [ids.harbor], actorUserId: people.avery.id };
    await write((tx) => trashRows(tx, harbor));
    const read = await readRow(db, { userId: people.avery.id, rowId: ids.leak });
    expect(Object.keys(read.values)).not.toContain(client.id);
    await write((tx) => restoreRows(tx, harbor));

    await expect(readRow(db, { userId: people.casey.id, rowId: ids.leak })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(readRow(db, { userId: people.avery.id, rowId: newId() })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('gives values as their cells show them, in each person’s time zone', async () => {
    await write((tx) =>
      updateRows(tx, {
        databaseId: visitsId,
        rowIds: [ids.leak],
        values: { [visit.id]: { start: '2026-10-27T16:00:00Z', end: null, hasTime: true } },
        actorUserId: people.avery.id,
        source: 'user',
      }),
    );
    const asked = [nameId, visit.id, hours.id, assignee.id, gate.id, client.id];
    const jordan = await readRowText(db, {
      userId: people.jordan.id,
      rowId: ids.leak,
      propertyIds: asked,
    });
    expect(jordan).toEqual({
      [nameId]: 'Leaking pipe',
      [visit.id]: 'Oct 27, 2026 11:00 AM',
      [hours.id]: '2',
      [assignee.id]: 'Jordan Park',
      [client.id]: 'Harbor Dental',
    });
    const avery = await readRowText(db, {
      userId: people.avery.id,
      rowId: ids.leak,
      propertyIds: [gate.id, visit.id],
    });
    expect(avery).toEqual({ [gate.id]: '4821', [visit.id]: 'Oct 27, 2026 16:00' });
  });

  it('finds the rows a person can open that match a filter as they see it', async () => {
    const gateSet: FilterGroup = {
      kind: 'group',
      id: newId(),
      combinator: 'and',
      children: [{ kind: 'condition', id: newId(), propertyId: gate.id, op: 'is_not_empty' }],
    };
    const find = (who: TestUser, filter: FilterGroup | null, limit?: number) =>
      findRowIds(db, { userId: who.id, databaseId: visitsId, filter, limit });
    expect(await find(people.avery, gateSet)).toEqual([
      { rowId: ids.leak, access: 'edit' },
      { rowId: ids.tap, access: 'edit' },
    ]);
    // Jordan can't see the gate code, so it reads as empty.
    expect(await find(people.jordan, gateSet)).toEqual([]);

    const all = await find(people.jordan, null);
    expect(all).toHaveLength(7);
    expect(all.slice(0, 4)).toEqual([
      { rowId: ids.leak, access: 'view' },
      { rowId: ids.heater, access: 'view' },
      { rowId: ids.tap, access: 'view' },
      { rowId: ids.frozen, access: 'view' },
    ]);
    expect(await find(people.jordan, null, 1)).toEqual([{ rowId: ids.leak, access: 'view' }]);
    await expect(find(people.casey, null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      findRowIds(db, { userId: people.avery.id, databaseId: newId(), filter: null }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lists the databases a person can add to a calendar', async () => {
    // A layer can use a view's filter: not a form's.
    const record = await loadDatabase(db, visitsId);
    const views = record!.views
      .filter((v) => v.id !== formViewId)
      .map((v) => ({ viewId: v.id, name: v.name }));
    expect(views).toHaveLength(1);
    expect(await listDateSources(db, viewerOf(people.jordan))).toEqual([
      {
        databaseId: visitsId,
        title: 'Visits',
        canEdit: false,
        dateProperties: [{ propertyId: visit.id, name: 'Visit' }],
        views,
      },
    ]);
    expect(await listDateSources(db, viewerOf(people.avery))).toEqual([
      {
        databaseId: visitsId,
        title: 'Visits',
        canEdit: true,
        dateProperties: [
          { propertyId: visit.id, name: 'Visit' },
          { propertyId: followUp.id, name: 'Follow-up' },
        ],
        views,
      },
    ]);
    expect(await listDateSources(db, viewerOf(people.casey))).toEqual([]);
    expect(await listDateSources(db, { userId: people.avery.id, workspaceId: newId() })).toEqual(
      [],
    );
  });

  it('lists the rows on a calendar layer by the days they fall on', async () => {
    const setDate = (rowId: string, value: object) =>
      write((tx) =>
        updateRows(tx, {
          databaseId: visitsId,
          rowIds: [rowId],
          values: { [visit.id]: value },
          actorUserId: people.avery.id,
          source: 'user',
        }),
      );
    await setDate(ids.heater, {
      start: '2026-10-26',
      end: '2026-10-28',
      hasTime: false,
      reminder: { daysBefore: 1 },
    });
    await setDate(ids.tap, { start: '2026-11-02', end: null, hasTime: false });
    await setDate(imported[0]!, { start: '2026-10-27T03:00:00Z', end: null, hasTime: true });

    const layer: DatedRowsQuery = {
      databaseId: visitsId,
      propertyId: visit.id,
      viewId: null,
      from: '2026-10-26',
      to: '2026-10-28',
      timeZone: 'America/Chicago',
      limit: 1000,
    };
    const heater = {
      rowId: ids.heater,
      title: 'Water heater',
      allDay: true,
      start: '2026-10-26',
      end: '2026-10-28',
      canEdit: false,
    };
    // 03:00 UTC is still the 26th in Chicago, and the 27th in Tokyo.
    const harbor = {
      rowId: imported[0],
      title: 'Harbor Dental',
      allDay: false,
      start: '2026-10-27T03:00:00.000Z',
      end: null,
      canEdit: false,
    };
    const leak = {
      rowId: ids.leak,
      title: 'Leaking pipe',
      allDay: false,
      start: '2026-10-27T16:00:00.000Z',
      end: null,
      canEdit: false,
    };
    const jordan = viewerOf(people.jordan);
    expect(await listDatedRows(db, jordan, layer)).toEqual({
      rows: [heater, harbor, leak],
      truncated: false,
    });
    const tokyo = { ...layer, from: '2026-10-28', to: '2026-10-29', timeZone: 'Asia/Tokyo' };
    expect(await listDatedRows(db, jordan, tokyo)).toEqual({
      rows: [heater, leak],
      truncated: false,
    });
    expect(await listDatedRows(db, jordan, { ...layer, limit: 1 })).toEqual({
      rows: [heater],
      truncated: true,
    });
    const avery = await listDatedRows(db, viewerOf(people.avery), layer);
    expect(avery?.rows.map((r) => r.canEdit)).toEqual([true, true, true]);

    // A view's filter, as the person sees it.
    const leaks: FilterGroup = {
      kind: 'group',
      id: newId(),
      combinator: 'and',
      children: [
        { kind: 'condition', id: newId(), propertyId: nameId, op: 'contains', value: 'Leak' },
      ],
    };
    const saved = await settings(visitsId, (current) => ({
      views: current.views.map((view) =>
        view.layout === 'form' ? view : { ...view, filter: leaks },
      ),
    }));
    const viewId = saved.views.find((v) => v.layout === 'table')!.id;
    expect(await listDatedRows(db, jordan, { ...layer, viewId })).toEqual({
      rows: [leak],
      truncated: false,
    });

    // Null when the layer is gone for them; 400 when the range doesn't read.
    const gone: [CalendarViewer, Partial<DatedRowsQuery>][] = [
      [jordan, { databaseId: newId() }],
      [{ ...jordan, workspaceId: newId() }, {}],
      [viewerOf(people.casey), {}],
      [jordan, { propertyId: followUp.id }],
      [jordan, { propertyId: hours.id }],
      [jordan, { viewId: newId() }],
    ];
    for (const [who, change] of gone) {
      expect(await listDatedRows(db, who, { ...layer, ...change })).toBeNull();
    }
    for (const change of [{ from: 'Oct 26' }, { to: '2026-10-01' }, { timeZone: 'Mars/Base' }]) {
      await expect(listDatedRows(db, jordan, { ...layer, ...change })).rejects.toMatchObject({
        statusCode: 400,
      });
    }
  });

  it('moves a row’s date as editing the cell does', async () => {
    const avery = viewerOf(people.avery);
    const move = (who: CalendarViewer, rowId: string, patch: Partial<RowDatePatch> = {}) =>
      write((tx) =>
        setRowDate(tx, who, rowId, {
          propertyId: visit.id,
          allDay: true,
          start: '2026-11-03',
          end: null,
          ...patch,
        }),
      );
    const dateOf = async (rowId: string) => (await stored(rowId))?.values[visit.id];

    const before = events.length;
    await move(avery, ids.heater, { start: '2026-10-29', end: '2026-10-30' });
    expect(await dateOf(ids.heater)).toEqual({
      start: '2026-10-29',
      end: '2026-10-30',
      hasTime: false,
      reminder: { daysBefore: 1 },
    });
    expect(await eventsSince(before)).toEqual([
      {
        name: 'databases.row.updated',
        payload: {
          workspaceId,
          databaseId: visitsId,
          rowId: ids.heater,
          actorId: people.avery.id,
          propertyIds: [visit.id],
          source: 'user',
        },
      },
    ]);
    // A one-day date has no end; a date that gets a time drops its all-day reminder.
    await move(avery, ids.heater, { start: '2026-10-29', end: '2026-10-29' });
    expect(await dateOf(ids.heater)).toEqual({
      start: '2026-10-29',
      end: null,
      hasTime: false,
      reminder: { daysBefore: 1 },
    });
    await move(avery, ids.heater, {
      allDay: false,
      start: '2026-10-29T15:00:00Z',
      end: '2026-10-29T16:30:00Z',
    });
    expect(await dateOf(ids.heater)).toEqual({
      start: '2026-10-29T15:00:00.000Z',
      end: '2026-10-29T16:30:00.000Z',
      hasTime: true,
    });

    const jordan = viewerOf(people.jordan);
    const refusals: [CalendarViewer, string, Partial<RowDatePatch>, number][] = [
      [jordan, ids.heater, {}, 403],
      [viewerOf(people.casey), ids.heater, {}, 404],
      [{ ...avery, workspaceId: newId() }, ids.heater, {}, 404],
      [avery, newId(), {}, 404],
      [jordan, ids.heater, { propertyId: followUp.id }, 404],
      [avery, ids.heater, { propertyId: hours.id }, 400],
      [avery, ids.heater, { end: '2026-11-01' }, 400],
      [avery, ids.heater, { allDay: false }, 400],
    ];
    for (const [who, rowId, patch, status] of refusals) {
      await expect(move(who, rowId, patch)).rejects.toMatchObject({ statusCode: status });
    }
    expect(await dateOf(ids.heater)).toMatchObject({ start: '2026-10-29T15:00:00.000Z' });
    await expect(
      db.transaction((tx) =>
        setRowDate(tx, avery, ids.heater, {
          propertyId: visit.id,
          allDay: true,
          start: '2026-11-03',
        }),
      ),
    ).rejects.toThrow(NOT_RUN_BY_RUN_ROW_WRITES);
  });
});
