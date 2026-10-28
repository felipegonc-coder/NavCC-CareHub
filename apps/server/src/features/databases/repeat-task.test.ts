// Repeating templates on a real database (Templates and buttons 3.2, TB-07): a weekday repeat at
// 9:00 AM America/Denver makes one row each weekday at that local time, across the clock change,
// named with the template's name and the date and created by the person who set it up (source
// 'template'); once per run, even when two runs overlap; a run missed while Care Hub was down is
// made once; it stops after the set number of times. When its setter leaves the workspace or can
// only view the database, it pauses and the people with Full access get a notice; turning it back
// on starts it again. Settings saves keep the repeat states in step. Fictional people only.
import { newId, type RepeatSchedule, type RowTemplate } from '@carehub/databases';
import { REPEAT_MESSAGES } from '@carehub/databases/repeat';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { bindMemoryNotices } from '../notices/testing';
import { syncDefaultWorkspace } from '../workspaces';
import { onDatabaseEvent, type DatabaseEvent } from './api';
import type { DatabaseRecord, DatabaseSettings } from './record';
import {
  PAUSED_REASONS,
  REPEATS_EVERY_MS,
  REPEATS_TASK,
  REPEAT_NOTICES,
  runRepeats,
  syncDatabaseRepeats,
} from './repeat-task';
import { changeDatabase, loadDatabase } from './store';

type Role = 'admin' | 'editor';
describe('repeat words', () => {
  it('uses fixed words', () => {
    expect(REPEAT_NOTICES).toEqual({
      sender: 'Databases',
      title: 'Repeating template paused',
      noAccess:
        'A repeating template was paused because the person who set it up no longer has access.',
      failed: "A repeating template was paused because its row couldn't be made.",
    });
    expect(REPEAT_NOTICES.noAccess).toBe(REPEAT_MESSAGES.paused);
    expect(PAUSED_REASONS).toEqual({ noAccess: 'no_access', failed: 'failed' });
    expect([REPEATS_TASK, REPEATS_EVERY_MS]).toEqual(['databases.repeats', 900_000]);
  });
});

describe.skipIf(!hasDatabase)('repeating templates', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let stopEvents: () => void;
  let workspaceId: string;
  let spaceId: string;
  let pageId: string;
  const events: DatabaseEvent[] = [];
  const people = {} as Record<'admin' | 'sam' | 'jordan' | 'avery', TestUser>;

  /** A member of the Operations space with a built-in role. */
  async function person(role: Role, name: string): Promise<TestUser> {
    const user = await createUser(db, { role, name });
    await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
      VALUES (${spaceId}, 'user', ${user.id})`);
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

  /** Changes one template's repeat. */
  const changeRepeat = (databaseId: string, templateId: string, change: Partial<RepeatSchedule>) =>
    settings(databaseId, (current) => ({
      templates: current.templates.map((t) =>
        t.id === templateId && t.repeat ? { ...t, repeat: { ...t.repeat, ...change } } : t,
      ),
    }));

  const template = (name: string, repeat: RepeatSchedule): RowTemplate => ({
    id: newId(),
    name,
    icon: null,
    values: {},
    repeat,
  });

  const weekdays = (ownerId: string, timesLeft: number | null): RepeatSchedule => ({
    every: 'weekday',
    time: '09:00',
    timeZone: 'America/Denver',
    start: '2031-10-27',
    end: null,
    timesLeft,
    paused: false,
    ownerId,
  });

  const daily = (ownerId: string): RepeatSchedule => ({
    every: 'day',
    time: '08:00',
    timeZone: 'America/Denver',
    start: '2031-10-27',
    end: null,
    timesLeft: null,
    paused: false,
    ownerId,
  });

  async function stateOf(templateId: string) {
    const { rows } = await db.execute<{
      next_run_at: Date | string | null;
      last_run_at: Date | string | null;
      paused_reason: string | null;
    }>(sql`
      SELECT next_run_at, last_run_at, paused_reason FROM db_repeat_state
      WHERE template_id = ${templateId}`);
    const row = rows[0];
    const iso = (value: Date | string | null) =>
      value === null ? null : new Date(value).toISOString();
    return row
      ? { next: iso(row.next_run_at), last: iso(row.last_run_at), paused: row.paused_reason }
      : undefined;
  }

  async function rowsOf(databaseId: string) {
    const { rows } = await db.execute<{ title: string; created_by: string | null }>(sql`
      SELECT p.title, r.created_by FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.database_id = ${databaseId} AND p.deleted_at IS NULL
      ORDER BY r.created_at, p.title`);
    return rows.map((r) => ({ title: r.title, createdBy: r.created_by }));
  }

  async function repeatOf(databaseId: string, templateId: string) {
    const record = await loadDatabase(db, databaseId);
    return record?.templates.find((t) => t.id === templateId)?.repeat ?? null;
  }

  const nameOf = (userId: string) =>
    Object.entries(people).find(([, user]) => user.id === userId)?.[0] ?? userId;

  /** The paused notices about this database, by person. */
  const pausedNotices = (databaseId: string) =>
    notices.store.records
      .filter((n) => n.card?.type === 'page' && n.card.pageId === databaseId)
      .map((n) => ({
        to: nameOf(n.userId),
        kind: n.kind,
        sender: n.sender,
        title: n.title,
        text: n.text,
      }))
      .sort((a, b) => a.to.localeCompare(b.to));

  const paused = (to: string) => ({
    to,
    kind: 'alert',
    sender: 'Databases',
    title: 'Repeating template paused',
    text: REPEAT_MESSAGES.paused,
  });

  const at = (time: string) => runRepeats(app, new Date(time));

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
    people.jordan = await person('editor', 'Jordan Park');
    people.avery = await person('editor', 'Avery Lin');
  });

  afterAll(async () => {
    stopEvents?.();
    notices?.unbind();
    await close?.();
  });

  it('makes a row each weekday at 9:00 AM Denver time, across the clock change', async () => {
    const huddles = await newDatabase('Huddles');
    const huddle = template('Weekly huddle', weekdays(people.sam.id, 3));
    await settings(huddles, () => ({ templates: [huddle] }));

    // The task first sees it on Thursday after 9:00 AM: it starts from then.
    expect(await at('2031-10-30T16:00:00.000Z')).toBe(0);
    expect(await stateOf(huddle.id)).toEqual({
      next: '2031-10-31T15:00:00.000Z',
      last: '2031-10-30T16:00:00.000Z',
      paused: null,
    });
    expect(await rowsOf(huddles)).toEqual([]);

    await app.events.settled();
    const count = events.length;
    expect(await at('2031-10-31T15:05:00.000Z')).toBe(1);
    expect(await rowsOf(huddles)).toEqual([
      { title: 'Weekly huddle – Oct 31', createdBy: people.sam.id },
    ]);
    const created = (await eventsSince(count)).filter((e) => e.name === 'databases.row.created');
    expect(created.map((e) => e.payload)).toMatchObject([
      { databaseId: huddles, actorId: people.sam.id, source: 'template' },
    ]);
    // After the clock change on Sunday, 9:00 AM in Denver is 16:00 UTC.
    expect(await stateOf(huddle.id)).toEqual({
      next: '2031-11-03T16:00:00.000Z',
      last: '2031-10-31T15:00:00.000Z',
      paused: null,
    });
    expect((await repeatOf(huddles, huddle.id))?.timesLeft).toBe(2);
    expect(await at('2031-10-31T15:20:00.000Z')).toBe(0);

    // Two runs at once make Monday's row once.
    const made = await Promise.all([
      at('2031-11-03T16:05:00.000Z'),
      at('2031-11-03T16:05:00.000Z'),
    ]);
    expect(made[0]! + made[1]!).toBe(1);
    expect((await repeatOf(huddles, huddle.id))?.timesLeft).toBe(1);

    // Care Hub was down on Tuesday and Wednesday morning: Wednesday's row is made once, the last.
    expect(await at('2031-11-05T18:00:00.000Z')).toBe(1);
    expect((await rowsOf(huddles)).map((r) => r.title)).toEqual([
      'Weekly huddle – Oct 31',
      'Weekly huddle – Nov 3',
      'Weekly huddle – Nov 5',
    ]);
    expect((await repeatOf(huddles, huddle.id))?.timesLeft).toBe(0);
    expect(await stateOf(huddle.id)).toEqual({
      next: null,
      last: '2031-11-05T16:00:00.000Z',
      paused: null,
    });
    expect(await at('2031-11-06T16:05:00.000Z')).toBe(0);
    expect(await rowsOf(huddles)).toHaveLength(3);
  });

  it('pauses when its setter leaves, tells Full access people, and starts again', async () => {
    const checks = await newDatabase('Checks');
    const check = template('Daily check', daily(people.jordan.id));
    await settings(checks, () => ({ templates: [check] }));
    // It last ran on Monday; Tuesday's run is due.
    await db.execute(sql`
      INSERT INTO db_repeat_state (template_id, database_id, next_run_at, last_run_at)
      VALUES (${check.id}, ${checks}, '2031-11-11T15:00:00Z', '2031-11-10T15:00:00Z')`);
    await db.execute(sql`
      UPDATE workspace_members SET removed_at = now()
      WHERE workspace_id = ${workspaceId} AND user_id = ${people.jordan.id}`);

    expect(await at('2031-11-11T15:05:00.000Z')).toBe(0);
    expect(await rowsOf(checks)).toEqual([]);
    expect(await stateOf(check.id)).toEqual({
      next: null,
      last: '2031-11-10T15:00:00.000Z',
      paused: 'no_access',
    });
    expect((await repeatOf(checks, check.id))?.paused).toBe(true);
    // Morgan, an Admin, has Full access; Sam and Avery can edit.
    expect(pausedNotices(checks)).toEqual([paused('admin')]);
    expect(await at('2031-11-12T15:05:00.000Z')).toBe(0);
    expect(pausedNotices(checks)).toHaveLength(1);

    // Jordan is back and turns it on again: it starts from then.
    await db.execute(sql`
      UPDATE workspace_members SET removed_at = NULL
      WHERE workspace_id = ${workspaceId} AND user_id = ${people.jordan.id}`);
    await changeRepeat(checks, check.id, { paused: false });
    await syncDatabaseRepeats(db, checks, new Date('2031-11-13T12:00:00.000Z'));
    expect(await stateOf(check.id)).toEqual({
      next: '2031-11-13T15:00:00.000Z',
      last: '2031-11-13T12:00:00.000Z',
      paused: null,
    });
    expect(await at('2031-11-13T15:05:00.000Z')).toBe(1);
    expect(await rowsOf(checks)).toEqual([
      { title: 'Daily check – Nov 13', createdBy: people.jordan.id },
    ]);
  });

  it('pauses when its setter can only view the database', async () => {
    const audits = await newDatabase('Audits');
    const audit = template('Van audit', daily(people.avery.id));
    await settings(audits, () => ({ templates: [audit] }));
    await syncDatabaseRepeats(db, audits, new Date('2031-11-14T12:00:00.000Z'));
    await db.execute(sql`UPDATE pages SET inherit_access = false WHERE id = ${audits}`);
    await db.execute(sql`INSERT INTO access_grants
      (workspace_id, page_id, principal_type, principal_id, level)
      VALUES (${workspaceId}, ${audits}, 'user', ${people.avery.id}, 'view')`);

    // (Checks makes its Friday row in the same run.)
    await at('2031-11-14T15:05:00.000Z');
    expect(await rowsOf(audits)).toEqual([]);
    expect((await stateOf(audit.id))?.paused).toBe('no_access');
    expect(pausedNotices(audits)).toEqual([paused('admin')]);
  });

  it('follows settings saves: new repeats start, changed ones move, removed ones go', async () => {
    const rounds = await newDatabase('Rounds');
    const round = template('Morning round', {
      every: 'week',
      weekDays: [1, 3],
      time: '07:30',
      timeZone: 'America/New_York',
      start: '2031-12-01',
      end: null,
      timesLeft: null,
      paused: false,
      ownerId: people.sam.id,
    });
    const saved = async () => {
      app.events.emit('databases.database.updated', {
        workspaceId,
        databaseId: rounds,
        actorId: people.admin.id,
        what: 'templates',
      });
      await app.events.settled();
    };
    await settings(rounds, () => ({ templates: [round] }));
    await saved();
    expect(await stateOf(round.id)).toMatchObject({
      next: '2031-12-01T12:30:00.000Z',
      paused: null,
    });

    await changeRepeat(rounds, round.id, { time: '10:00' });
    await saved();
    expect((await stateOf(round.id))?.next).toBe('2031-12-01T15:00:00.000Z');

    await changeRepeat(rounds, round.id, { paused: true });
    await saved();
    expect((await stateOf(round.id))?.next).toBeNull();

    await settings(rounds, (current) => ({
      templates: current.templates.map((t) => ({ ...t, repeat: null })),
    }));
    await saved();
    expect(await stateOf(round.id)).toBeUndefined();
  });
});
