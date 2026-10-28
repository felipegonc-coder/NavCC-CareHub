// Button presses on a real database (decision 0200; Templates and buttons 3.4): a run carried out
// with the presser's own access through the rows API, logged (the newest 50 per button) and undone
// within 8 seconds by the person who pressed; steps into a database they can't change; messages
// only to people who can open the row, at most 50, and to Everyone or roles only from Admins; the
// confirmation; and no presses in Trash or on archived pages. Fictional people only.
import { randomUUID } from 'node:crypto';
import {
  ME,
  defaultConfig,
  newProperty,
  type ButtonAction,
  type Property,
} from '@carehub/databases';
import { BUTTON_MESSAGES, type ButtonConfig } from '@carehub/databases/buttons';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { bindMemoryNotices } from '../notices/testing';
import { onDatabaseEvent, type DatabaseEvent } from './api';
import { BUTTON_NOTICES, BUTTON_RUN_MESSAGES } from './button-runs';
import type { DatabaseRecord, DatabaseSettings } from './record';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor' | 'viewer';
const PERMISSIONS: Record<Role, string[]> = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };
const refused = (code: 'forbidden' | 'invalid', message: string) => ({ error: { code, message } });

const button = (name: string, actions: ButtonAction[]): Property<ButtonConfig> =>
  newProperty<ButtonConfig>(name, { type: 'button', label: name, actions });

describe.skipIf(!hasDatabase)('database buttons', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let stopEvents: () => void = () => undefined;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  let visitsId: string;
  let invoicesId: string;
  let nameId: string;
  const people = {} as Record<'admin' | 'avery' | 'jordan' | 'sam' | 'casey', TestUser>;
  const roleOf = {} as Record<'jordan', string>;
  const ids = {} as Record<'leak' | 'heater' | 'invoice', string>;
  const events: DatabaseEvent[] = [];

  // Visits' properties; the buttons are made once the people exist.
  const hours = newProperty('Hours', defaultConfig('number'));
  const notes = newProperty('Notes', defaultConfig('text'));
  const assignee = newProperty('Assignee', defaultConfig('person'));
  const memo = newProperty('Memo', defaultConfig('text'));
  const buttons = {} as Record<
    | 'finish'
    | 'follow'
    | 'bill'
    | 'audit'
    | 'notify'
    | 'crowd'
    | 'role'
    | 'noRole'
    | 'noGroup'
    | 'everyone'
    | 'close'
    | 'checkAll'
    | 'empty'
    | 'quiet',
    Property<ButtonConfig>
  >;

  // Stand-ins for the roles pull request's tables (decision 0007 names) until it lands.
  async function standInWorkspace() {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
      gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL,
      permissions text[] NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id uuid NOT NULL,
      user_id uuid NOT NULL, role_id uuid, kind text NOT NULL DEFAULT 'member',
      PRIMARY KEY (workspace_id, user_id))`);
    const { rows } = await db.execute<{ id: string }>(
      sql`INSERT INTO workspaces (name) VALUES ('Blue Pine Plumbing') RETURNING id`,
    );
    workspaceId = rows[0]!.id;
  }

  /** A member with a role of their own; in the Operations space unless `inSpace` is false. */
  async function person(role: Role, name: string, inSpace = true): Promise<TestUser> {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${name}`},
        ${`{${PERMISSIONS[role].join(',')}}`}::text[])
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

  async function settings(
    id: string,
    change: (current: DatabaseRecord) => Partial<DatabaseSettings>,
  ): Promise<DatabaseRecord> {
    const current = await loadDatabase(db, id);
    if (!current) throw new Error('The test database is missing.');
    return changeDatabase(db, id, current.version, change);
  }

  async function addRow(who: TestUser, title: string, databaseId = visitsId, values = {}) {
    const res = await injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${databaseId}/rows`,
      payload: { title, values },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  const press = (who: TestUser, rowId: string, pressed: Property, payload: object = {}) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${visitsId}/rows/${rowId}/buttons/${pressed.id}`,
      payload,
    });

  const undo = (who: TestUser, runId: string) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${visitsId}/button-runs/${runId}/undo`,
      payload: {},
    });

  async function stored(rowId: string) {
    const { rows } = await db.execute<{
      title: string;
      values: Record<string, unknown>;
      in_trash: boolean;
    }>(sql`
      SELECT p.title, r."values", p.deleted_at IS NOT NULL AS in_trash
      FROM db_rows r JOIN pages p ON p.id = r.page_id WHERE r.page_id = ${rowId}`);
    return rows[0];
  }

  async function runOf(runId: string) {
    const { rows } = await db.execute<{
      by: string;
      outcome: string;
      failed_step: number | null;
      message: string | null;
      messaged: number;
      changes: unknown[];
    }>(sql`
      SELECT "by", outcome, failed_step, message, messaged, changes
      FROM db_button_runs WHERE id = ${runId}`);
    return rows[0];
  }

  async function rowCount(databaseId: string) {
    const { rows } = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.database_id = ${databaseId} AND p.deleted_at IS NULL`);
    return rows[0]!.n;
  }

  const buttonNotices = (who: TestUser) =>
    notices.store.records.filter((n) => n.userId === who.id && n.kind === 'automation');

  async function eventsSince(count: number): Promise<DatabaseEvent[]> {
    await app.events.settled();
    return events.slice(count);
  }

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    notices = bindMemoryNotices();
    stopEvents = onDatabaseEvent(app, (event) => {
      events.push(event);
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
    people.sam = await person('editor', 'Sam Ortiz');
    people.casey = await person('editor', 'Casey Brooks', false);
    const role = await db.execute<{ role_id: string }>(sql`
      SELECT role_id FROM workspace_members WHERE user_id = ${people.jordan.id}`);
    roleOf.jordan = role.rows[0]!.role_id;

    visitsId = await newDatabase('Visits');
    invoicesId = await newDatabase('Invoices');
    // Avery can only view Invoices.
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${invoicesId}`);
    await db.execute(sql`INSERT INTO access_grants
      (workspace_id, page_id, principal_type, principal_id, level)
      VALUES (${workspaceId}, ${invoicesId}, 'user', ${people.avery.id}, 'view')`);
    await settings(invoicesId, (current) => ({ properties: [...current.properties, memo] }));
    ids.invoice = await addRow(people.admin, 'Invoice 1001', invoicesId);

    const visits = await loadDatabase(db, visitsId);
    nameId = visits!.properties.find((p) => p.config.type === 'title')!.id;
    const to = (ids: Partial<Extract<ButtonAction, { kind: 'send_message' }>['to']>) => ({
      userIds: [],
      propertyIds: [],
      ...ids,
    });
    const message = (into: ReturnType<typeof to>, text = 'Please check this visit.') =>
      ({ kind: 'send_message', to: into, message: text }) as const;
    buttons.finish = button('Finish', [
      {
        kind: 'set_values',
        values: { [hours.id]: '2' },
        edits: { [notes.id]: { set: 'Finished' }, [nameId]: { set: 'Leak (done)' } },
      },
    ]);
    buttons.follow = button('Follow up', [
      {
        kind: 'add_row',
        databaseId: visitsId,
        edits: { [nameId]: { set: 'Follow-up visit' }, [assignee.id]: { set: [ME] } },
        open: 'side_peek',
      },
    ]);
    buttons.bill = button('Bill', [
      { kind: 'add_row', databaseId: invoicesId, edits: { [memo.id]: { set: 'Leak' } } },
    ]);
    buttons.audit = button('Audit', [
      {
        kind: 'edit_rows',
        databaseId: invoicesId,
        filter: null,
        edits: { [memo.id]: { set: 'Seen' } },
      },
    ]);
    buttons.notify = button('Notify', [
      message(to({ userIds: [people.jordan.id, people.casey.id], propertyIds: [assignee.id] })),
    ]);
    buttons.crowd = button('Crowd', [
      message(to({ userIds: Array.from({ length: 51 }, () => randomUUID()) })),
    ]);
    buttons.role = button('Role', [message(to({ roleIds: [roleOf.jordan] }))]);
    buttons.noRole = button('No role', [message(to({ roleIds: [randomUUID()] }))]);
    buttons.noGroup = button('No group', [message(to({ groupIds: [randomUUID()] }))]);
    buttons.everyone = button('Everyone', [message(to({ everyone: true }))]);
    buttons.close = button('Close', [
      {
        kind: 'confirm',
        title: 'Close this visit?',
        message: 'It moves to Done.',
        confirmLabel: 'Close',
      },
      { kind: 'set_values', values: { [notes.id]: 'Closed' } },
    ]);
    buttons.checkAll = button('Check all', [
      {
        kind: 'edit_rows',
        databaseId: visitsId,
        filter: null,
        edits: { [notes.id]: { set: 'Checked' } },
      },
    ]);
    buttons.empty = button('Empty', []);
    buttons.quiet = newProperty<ButtonConfig>('Quiet', {
      type: 'button',
      label: ' ',
      actions: [message(to({ userIds: [people.sam.id] }), 'Quiet please.')],
    });
    await settings(visitsId, (current) => ({
      properties: [...current.properties, hours, notes, assignee, ...Object.values(buttons)],
    }));
    ids.leak = await addRow(people.avery, 'Leak');
    ids.heater = await addRow(people.avery, 'Water heater', visitsId, {
      [assignee.id]: [people.sam.id],
      [notes.id]: 'Noisy',
    });
  });

  afterAll(async () => {
    stopEvents();
    notices?.unbind();
    await close?.();
  });

  it('carries out a press, logs it and undoes it within 8 seconds', async () => {
    const count = events.length;
    const res = await press(people.avery, ids.leak, buttons.finish);
    expect(res.statusCode).toBe(200);
    const answer = res.json();
    expect(answer).toMatchObject({ status: 'done', message: 'Done · Undo', open: [] });
    expect(Date.parse(answer.undoUntil) - Date.now()).toBeGreaterThan(5_000);
    expect(await stored(ids.leak)).toMatchObject({
      title: 'Leak (done)',
      values: { [hours.id]: '2', [notes.id]: 'Finished' },
    });
    expect(await eventsSince(count)).toContainEqual({
      name: 'databases.row.updated',
      payload: expect.objectContaining({
        rowId: ids.leak,
        databaseId: visitsId,
        actorId: people.avery.id,
        source: 'button',
      }),
    });
    expect(await runOf(answer.runId)).toMatchObject({
      by: people.avery.id,
      outcome: 'done',
      failed_step: null,
      changes: [expect.objectContaining({ rowId: ids.leak, added: false })],
    });

    // Only the person who pressed can undo it.
    expect((await undo(people.sam, answer.runId)).json()).toEqual(FORBIDDEN);
    const undone = await undo(people.avery, answer.runId);
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toEqual({ kept: 0, note: null });
    const back = await stored(ids.leak);
    expect(back?.title).toBe('Leak');
    expect(back?.values[hours.id] ?? null).toBeNull();
    expect(back?.values[notes.id] ?? null).toBeNull();
    // Once.
    const again = await undo(people.avery, answer.runId);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual(refused('invalid', BUTTON_RUN_MESSAGES.cantUndo));
  });

  it('keeps what someone changed since, and refuses Undo after 8 seconds', async () => {
    const first = (await press(people.avery, ids.leak, buttons.finish)).json();
    const patched = await injectAs(app, people.sam, {
      method: 'PATCH',
      url: `/api/databases/${visitsId}/rows/${ids.leak}`,
      payload: { values: { [hours.id]: '5' } },
    });
    expect(patched.statusCode).toBe(200);
    const undone = await undo(people.avery, first.runId);
    expect(undone.json()).toEqual({ kept: 1, note: null });
    expect(await stored(ids.leak)).toMatchObject({ title: 'Leak', values: { [hours.id]: '5' } });

    const late = (await press(people.avery, ids.leak, buttons.finish)).json();
    await db.execute(sql`UPDATE db_button_runs SET "at" = "at" - interval '9 seconds'
      WHERE id = ${late.runId}`);
    const res = await undo(people.avery, late.runId);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(refused('invalid', BUTTON_RUN_MESSAGES.cantUndo));
    expect((await stored(ids.leak))?.title).toBe('Leak (done)');
  });

  it('adds a row, opens it, and moves it to Trash on Undo', async () => {
    const count = events.length;
    const res = await press(people.avery, ids.leak, buttons.follow);
    expect(res.statusCode).toBe(200);
    const answer = res.json();
    const [opened] = answer.open;
    expect(answer.open).toEqual([{ kind: 'page', pageId: opened.pageId, openIn: 'side_peek' }]);
    expect(await stored(opened.pageId)).toMatchObject({
      title: 'Follow-up visit',
      values: { [assignee.id]: [people.avery.id] },
      in_trash: false,
    });
    expect(await eventsSince(count)).toContainEqual({
      name: 'databases.row.created',
      payload: expect.objectContaining({ rowId: opened.pageId, source: 'button' }),
    });
    expect((await undo(people.avery, answer.runId)).json()).toEqual({ kept: 0, note: null });
    expect((await stored(opened.pageId))?.in_trash).toBe(true);
  });

  it('edits rows of a database in one step, and puts each one back', async () => {
    const res = await press(people.avery, ids.leak, buttons.checkAll);
    expect(res.json()).toMatchObject({ status: 'done', message: 'Done · Undo' });
    expect((await stored(ids.heater))?.values[notes.id]).toBe('Checked');
    expect((await stored(ids.leak))?.values[notes.id]).toBe('Checked');
    expect((await undo(people.avery, res.json().runId)).json()).toEqual({ kept: 0, note: null });
    expect((await stored(ids.heater))?.values[notes.id]).toBe('Noisy');
  });

  it('refuses viewers, and steps into a database the presser can’t change', async () => {
    const viewer = await press(people.jordan, ids.leak, buttons.finish);
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual(refused('forbidden', BUTTON_MESSAGES.cantPress));

    const before = await rowCount(invoicesId);
    const bill = await press(people.avery, ids.leak, buttons.bill);
    expect(bill.statusCode).toBe(403);
    expect(bill.json()).toEqual(
      refused('forbidden', "Couldn't finish step 1: You can't add rows to Invoices."),
    );
    expect(await rowCount(invoicesId)).toBe(before);

    const audit = await press(people.avery, ids.leak, buttons.audit);
    expect(audit.statusCode).toBe(403);
    expect(audit.json()).toEqual(
      refused('forbidden', "Couldn't finish step 1: You can't edit rows in Invoices."),
    );
    expect((await stored(ids.invoice))?.values[memo.id] ?? null).toBeNull();

    const empty = await press(people.avery, ids.leak, buttons.empty);
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual(refused('invalid', BUTTON_MESSAGES.noActions));

    const notButton = await press(people.avery, ids.leak, hours);
    expect(notButton.statusCode).toBe(404);
  });

  it('sends messages only to people who can open the row', async () => {
    const res = await press(people.avery, ids.heater, buttons.notify);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'done', message: null, undoUntil: null, open: [] });
    for (const who of [people.jordan, people.sam]) {
      expect(buttonNotices(who)).toEqual([
        expect.objectContaining({
          kind: 'automation',
          sender: 'Avery Lin',
          actorUserId: people.avery.id,
          title: 'Notify',
          text: 'Please check this visit.',
          card: { type: 'page', pageId: ids.heater },
        }),
      ]);
    }
    // Casey isn't in the space, so she can't open the row.
    expect(buttonNotices(people.casey)).toEqual([]);
    expect(await runOf(res.json().runId)).toMatchObject({ outcome: 'done', messaged: 2 });

    // Without a label, the notice has our words for a title.
    expect((await press(people.avery, ids.heater, buttons.quiet)).statusCode).toBe(200);
    expect(buttonNotices(people.sam).at(-1)).toMatchObject({
      title: BUTTON_NOTICES.title,
      text: 'Quiet please.',
    });
  });

  it('sends to a role and to everyone who can open the row, when an Admin presses', async () => {
    const sent = notices.store.records.length;
    for (const pressed of [buttons.role, buttons.everyone]) {
      const res = await press(people.avery, ids.leak, pressed);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(
        refused('forbidden', BUTTON_MESSAGES.stepFailed(1, BUTTON_MESSAGES.adminsOnly)),
      );
    }
    expect(notices.store.records).toHaveLength(sent);

    const told = buttonNotices(people.jordan).length;
    const samTold = buttonNotices(people.sam).length;
    expect((await press(people.admin, ids.leak, buttons.role)).json().status).toBe('done');
    expect(buttonNotices(people.jordan)).toHaveLength(told + 1);
    expect(buttonNotices(people.sam)).toHaveLength(samTold);

    const everyone = await press(people.admin, ids.leak, buttons.everyone);
    expect(await runOf(everyone.json().runId)).toMatchObject({ messaged: 4 });
    expect(buttonNotices(people.admin)).toHaveLength(1);
    expect(buttonNotices(people.avery)).toHaveLength(1);
    expect(buttonNotices(people.casey)).toEqual([]);
  });

  it('logs a failed run for more than 50 people and for a missing role or group', async () => {
    const sent = notices.store.records.length;
    const cases = [
      [people.avery, buttons.crowd, BUTTON_MESSAGES.tooManyRecipients],
      [people.admin, buttons.noRole, BUTTON_MESSAGES.noRole],
      [people.avery, buttons.noGroup, BUTTON_MESSAGES.noGroup],
    ] as const;
    for (const [who, pressed, reason] of cases) {
      const res = await press(who, ids.leak, pressed);
      expect(res.statusCode).toBe(200);
      const message = BUTTON_MESSAGES.stepFailed(1, reason);
      expect(res.json()).toMatchObject({ status: 'failed', message, undoUntil: null, open: [] });
      expect(await runOf(res.json().runId)).toMatchObject({
        outcome: 'failed',
        failed_step: 1,
        message,
      });
    }
    expect(BUTTON_MESSAGES.stepFailed(1, BUTTON_MESSAGES.tooManyRecipients)).toBe(
      "Couldn't finish step 1: This message would go to more than 50 people.",
    );
    expect(notices.store.records).toHaveLength(sent);
  });

  it('asks first, and runs once the presser continues', async () => {
    const asked = await press(people.avery, ids.heater, buttons.close);
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({
      status: 'confirm',
      step: 1,
      title: 'Close this visit?',
      message: 'It moves to Done.',
      confirmLabel: 'Close',
    });
    expect((await stored(ids.heater))?.values[notes.id]).toBe('Noisy');
    const done = await press(people.avery, ids.heater, buttons.close, { confirmed: 1 });
    expect(done.json()).toMatchObject({ status: 'done', message: 'Done · Undo' });
    expect((await stored(ids.heater))?.values[notes.id]).toBe('Closed');
    expect(
      (await press(people.avery, ids.heater, buttons.close, { confirmed: 'yes' })).statusCode,
    ).toBe(400);
  });

  it('keeps the newest 50 runs per button, for people who can edit the database', async () => {
    for (let i = 1; i <= 55; i += 1) {
      await db.execute(sql`INSERT INTO db_button_runs
        (database_id, row_id, property_id, "by", "at", outcome)
        VALUES (${visitsId}, ${ids.leak}, ${buttons.role.id}, ${people.avery.id},
          now() - ${`${i} minutes`}::interval, 'done')`);
    }
    const latest = (await press(people.admin, ids.leak, buttons.role)).json();
    const res = await injectAs(app, people.avery, {
      method: 'GET',
      url: `/api/databases/${visitsId}/buttons/${buttons.role.id}/runs`,
    });
    expect(res.statusCode).toBe(200);
    const { runs } = res.json();
    expect(runs).toHaveLength(50);
    expect(runs[0]).toEqual({
      id: latest.runId,
      by: people.admin.id,
      at: expect.any(String),
      outcome: 'done',
      failedStep: null,
      message: null,
      rows: 0,
      skipped: 0,
      messaged: 1,
      undone: false,
    });
    const viewer = await injectAs(app, people.jordan, {
      method: 'GET',
      url: `/api/databases/${visitsId}/buttons/${buttons.role.id}/runs`,
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('refuses presses in Trash and on archived pages', async () => {
    const before = (await stored(ids.leak))?.values[notes.id] ?? null;
    const archive = (table: 'pages' | 'spaces', id: string, on: boolean) =>
      table === 'pages'
        ? db.execute(sql`UPDATE pages SET archived_at = ${on ? sql`now()` : null} WHERE id = ${id}`)
        : db.execute(
            sql`UPDATE spaces SET archived_at = ${on ? sql`now()` : null} WHERE id = ${id}`,
          );
    // The row, its database, the page the database is on, and the space.
    const places = [
      ['pages', ids.leak],
      ['pages', visitsId],
      ['pages', pageId],
      ['spaces', spaceId],
    ] as const;
    for (const [table, id] of places) {
      await archive(table, id, true);
      const res = await press(people.avery, ids.leak, buttons.finish);
      await archive(table, id, false);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(refused('forbidden', BUTTON_RUN_MESSAGES.archived));
    }

    const old = await addRow(people.avery, 'Old leak');
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${old}`);
    expect((await press(people.avery, old, buttons.finish)).statusCode).toBe(404);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${visitsId}`);
    const inTrash = await press(people.avery, ids.leak, buttons.finish);
    await db.execute(sql`UPDATE pages SET deleted_at = NULL WHERE id = ${visitsId}`);
    expect(inTrash.statusCode).toBe(404);
    expect((await stored(ids.leak))?.values[notes.id] ?? null).toEqual(before);
  });

  it('uses fixed words', () => {
    expect(BUTTON_RUN_MESSAGES).toEqual({
      cantUndo: "This run can't be undone anymore.",
      archived: 'This page is archived.',
    });
    expect(BUTTON_NOTICES).toEqual({ title: 'A button sent you a message' });
    expect(BUTTON_MESSAGES.stepFailed(1, BUTTON_MESSAGES.adminsOnly)).toBe(
      "Couldn't finish step 1: Only Admins can send messages to Everyone or to roles.",
    );
  });
});
