// Applying a template to a row on a real database (Templates and buttons 3.2 and 5, TB-05 and
// TB-06): the template's values fill only empty properties unless Replace values is on; Today + 3
// days and Me become the person's own; properties they may not change stay as they are; it needs
// Can edit content on the row (403 otherwise, before anything changes), which guests can have but
// people outside the workspace can't; the row must be one of the database's, not in Trash.
// Fictional people only.
import {
  ME,
  defaultConfig,
  newProperty,
  type Property,
  type RowTemplate,
} from '@carehub/databases';
import { resolveDynamicDate } from '@carehub/databases/templates';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { syncDefaultWorkspace } from '../workspaces';
import { onDatabaseEvent, type DatabaseEvent } from './api';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { changeDatabase, loadDatabase } from './store';
import { applyTemplateRequest } from './templates-apply';

type Role = 'admin' | 'editor' | 'viewer';
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };

describe('the apply request', () => {
  it('takes a row and Replace values, nothing else', () => {
    const rowId = '0b6f2a52-3f7e-4a63-9d55-6f4f3f1b8c21';
    expect(applyTemplateRequest.safeParse({ rowId }).success).toBe(true);
    expect(applyTemplateRequest.safeParse({ rowId, replace: true }).success).toBe(true);
    expect(applyTemplateRequest.safeParse({ rowId: 'leak' }).success).toBe(false);
    expect(applyTemplateRequest.safeParse({ rowId, replace: 'yes' }).success).toBe(false);
    expect(applyTemplateRequest.safeParse({ rowId, values: {} }).success).toBe(false);
  });
});

describe.skipIf(!hasDatabase)('applying a template to a row', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let stopEvents: () => void;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let visitsId: string;
  let quotesId: string;
  let nameId: string;
  const events: DatabaseEvent[] = [];
  const people = {} as Record<'admin' | 'sam' | 'jordan' | 'casey', TestUser>;

  const status = newProperty('Status', defaultConfig('status'));
  const due = newProperty('Due', defaultConfig('date'));
  const owner = newProperty('Owner', defaultConfig('person'));
  const notes = newProperty('Notes', defaultConfig('text'));
  const done = newProperty('Done', defaultConfig('checkbox'));
  let rate: Property;
  const [notStarted, inProgress, finished] = status.config.options;
  const standard: RowTemplate = {
    id: 'standard-visit',
    name: 'Standard visit',
    icon: null,
    values: {},
  };

  /** A member with a built-in role; in the Operations space unless `inSpace` is false. */
  async function person(role: Role, name: string, inSpace = true): Promise<TestUser> {
    const user = await createUser(db, { role, name });
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
    return res.json().id as string;
  }

  async function settings(
    id: string,
    change: (current: DatabaseRecord) => Partial<DatabaseSettings>,
  ): Promise<DatabaseRecord> {
    const current = await loadDatabase(db, id);
    if (!current) throw new Error('The test database is missing.');
    return changeDatabase(db, id, current.version, change);
  }

  async function addRow(title: string, values: Record<string, unknown>, databaseId = visitsId) {
    const res = await injectAs(app, people.admin, {
      method: 'POST',
      url: `/api/databases/${databaseId}/rows`,
      payload: { title, values, templateId: null },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  const apply = (who: TestUser, payload: object, templateId = standard.id, databaseId = visitsId) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${databaseId}/templates/${templateId}/apply`,
      payload,
    });

  /** Shares Visits with this person directly. */
  async function share(who: TestUser, level: 'view' | 'edit') {
    await db.execute(sql`INSERT INTO access_grants
      (workspace_id, page_id, principal_type, principal_id, level)
      VALUES (${workspaceId}, ${visitsId}, 'user', ${who.id}, ${level})`);
  }

  async function stored(rowId: string) {
    const { rows } = await db.execute<{ title: string; values: Record<string, unknown> }>(sql`
      SELECT p.title, r."values" FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.page_id = ${rowId}`);
    return rows[0]!;
  }

  async function eventsSince(count: number): Promise<DatabaseEvent[]> {
    await app.events.settled();
    return events.slice(count);
  }

  /** Today + 3 days for this person, as a template's preset becomes it. */
  async function inThreeDays(who: TestUser) {
    const { rows } = await db.execute<{ time_zone: string }>(sql`
      SELECT time_zone FROM users WHERE id = ${who.id}`);
    const viewer = { timeZone: rows[0]!.time_zone, now: new Date() };
    return resolveDynamicDate({ dynamic: 'today', offsetDays: 3 }, viewer);
  }

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    stopEvents = onDatabaseEvent(app, (event) => {
      events.push(event);
    });
    workspaceId = (await syncDefaultWorkspace(db)).id;
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'a0') RETURNING id`);
    pageId = page.rows[0]!.id;
    people.admin = await person('admin', 'Morgan Reyes');
    people.sam = await person('editor', 'Sam Ortiz');
    people.jordan = await person('viewer', 'Jordan Park');
    people.casey = await person('editor', 'Casey Brooks', false);
    await db.execute(sql`
      UPDATE users SET time_zone = 'America/New_York' WHERE id = ${people.sam.id}`);

    // Only Morgan may change Rate.
    rate = {
      ...newProperty('Rate', defaultConfig('number')),
      access: { see: null, change: [{ type: 'user', id: people.admin.id }] },
    };
    visitsId = await newDatabase('Visits');
    const visits = await settings(visitsId, (current) => ({
      properties: [...current.properties, status, due, owner, notes, done, rate],
    }));
    nameId = visits.properties.find((p) => p.config.type === 'title')!.id;
    standard.values = {
      [nameId]: 'Standard visit',
      [status.id]: inProgress!.id,
      [due.id]: { dynamic: 'today', offsetDays: 3 },
      [owner.id]: [ME],
      [notes.id]: [{ text: 'Bring the leak kit.' }],
      [done.id]: true,
      [rate.id]: '95',
    };
    await settings(visitsId, () => ({ templates: [standard] }));
    quotesId = await newDatabase('Quotes');
  });

  afterAll(async () => {
    stopEvents?.();
    await close?.();
  });

  it('fills only the empty properties, with Today + 3 days and Me for the person', async () => {
    const leak = await addRow('Leak under the sink', { [status.id]: finished!.id });
    await app.events.settled();
    const count = events.length;

    const res = await apply(people.sam, { rowId: leak });
    expect(res.statusCode).toBe(200);
    const answer = res.json();
    expect(answer.id).toBe(leak);
    expect(answer.title).toBe('Leak under the sink');
    const row = await stored(leak);
    expect(row.title).toBe('Leak under the sink');
    expect(row.values[status.id]).toBe(finished!.id);
    expect(row.values[due.id]).toEqual(await inThreeDays(people.sam));
    expect(row.values[owner.id]).toEqual([people.sam.id]);
    expect(row.values[notes.id]).toEqual([{ text: 'Bring the leak kit.' }]);
    expect(row.values[done.id]).toBe(true);
    // Only Morgan may change Rate: it stays empty for Sam, without a refusal.
    expect(row.values[rate.id]).toBeUndefined();
    expect(answer.values[notes.id]).toEqual([{ text: 'Bring the leak kit.' }]);

    const updated = (await eventsSince(count)).filter((e) => e.name === 'databases.row.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.payload).toMatchObject({
      databaseId: visitsId,
      rowId: leak,
      actorId: people.sam.id,
      source: 'template',
    });
  });

  it('counts an unticked checkbox and the default status as empty', async () => {
    const heater = await addRow('Water heater check', {
      [status.id]: notStarted!.id,
      [done.id]: false,
      [notes.id]: [{ text: 'Gate code 4821' }],
    });
    expect((await apply(people.sam, { rowId: heater, replace: false })).statusCode).toBe(200);
    const row = await stored(heater);
    expect(row.values[status.id]).toBe(inProgress!.id);
    expect(row.values[done.id]).toBe(true);
    expect(row.values[notes.id]).toEqual([{ text: 'Gate code 4821' }]);
  });

  it('replaces the values the template sets with Replace values', async () => {
    const drain = await addRow('Slow drain', {
      [status.id]: finished!.id,
      [notes.id]: [{ text: 'Customer asked for mornings' }],
      [owner.id]: [people.sam.id],
    });
    const res = await apply(people.admin, { rowId: drain, replace: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Standard visit');
    const row = await stored(drain);
    expect(row.title).toBe('Standard visit');
    expect(row.values[status.id]).toBe(inProgress!.id);
    expect(row.values[notes.id]).toEqual([{ text: 'Bring the leak kit.' }]);
    expect(row.values[owner.id]).toEqual([people.admin.id]);
    expect(row.values[due.id]).toEqual(await inThreeDays(people.admin));
    expect(row.values[rate.id]).toBe('95');
  });

  it('changes nothing when every value is there already', async () => {
    const filter = await addRow('Filter swap', {});
    expect((await apply(people.sam, { rowId: filter })).statusCode).toBe(200);
    await app.events.settled();
    const count = events.length;
    const res = await apply(people.sam, { rowId: filter });
    expect(res.statusCode).toBe(200);
    expect(await eventsSince(count)).toEqual([]);
  });

  it('refuses people who may not edit the row, before anything changes', async () => {
    const valve = await addRow('Shut-off valve', {});
    const before = await stored(valve);
    const viewer = await apply(people.jordan, { rowId: valve });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual(FORBIDDEN);
    const outsider = await apply(people.casey, { rowId: valve });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json()).toEqual(FORBIDDEN);
    // A guest who may only view, and someone outside the workspace even with an edit grant.
    const looker = await createUser(db, { kind: 'guest' });
    const stranger = await createUser(db, { role: null });
    for (const [who, level] of [
      [looker, 'view'],
      [stranger, 'edit'],
    ] as const) {
      await share(who, level);
      const res = await apply(who, { rowId: valve });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(FORBIDDEN);
    }
    expect(await stored(valve)).toEqual(before);
  });

  it('lets a guest who can edit the rows apply a template', async () => {
    const meter = await addRow('Water meter', {});
    const guest = await createUser(db, { kind: 'guest' });
    await share(guest, 'edit');
    const res = await apply(guest, { rowId: meter });
    expect(res.statusCode).toBe(200);
    const row = await stored(meter);
    expect(row.values[owner.id]).toEqual([guest.id]);
    expect(row.values[notes.id]).toEqual([{ text: 'Bring the leak kit.' }]);
    // Only Morgan may change Rate.
    expect(row.values[rate.id]).toBeUndefined();
  });

  it('needs a template and a row of the database, not in Trash', async () => {
    const sump = await addRow('Sump pump', {});
    const quote = await addRow('Quote 2207', {}, quotesId);
    const missing = await apply(people.sam, { rowId: sump }, 'no-such-template');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual(NOT_FOUND);
    const elsewhere = await apply(people.sam, { rowId: quote });
    expect(elsewhere.statusCode).toBe(404);
    const wrongDatabase = await apply(people.sam, { rowId: sump }, standard.id, quotesId);
    expect(wrongDatabase.statusCode).toBe(404);

    const trashed = await injectAs(app, people.admin, {
      method: 'POST',
      url: `/api/databases/${visitsId}/rows/trash`,
      payload: { rowIds: [sump] },
    });
    expect(trashed.statusCode).toBe(200);
    const inTrash = await apply(people.sam, { rowId: sump });
    expect(inTrash.statusCode).toBe(404);
    expect(inTrash.json()).toEqual(NOT_FOUND);
    expect((await stored(sump)).values[notes.id]).toBeUndefined();

    const bad = await apply(people.sam, { rowId: 'sump-pump' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual(INVALID);
  });
});
