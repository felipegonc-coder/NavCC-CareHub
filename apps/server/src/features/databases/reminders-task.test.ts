// Date reminders on a real database (decision 0200; Databases spec, Date): a reminder goes to the
// people in the row's Person properties, or to whoever set it when the row names nobody; minutes
// before a time, or at 9:00 AM in each person's own time zone for a date without one; once, even
// when two runs overlap; only to people who can still open the row; never more than a day late;
// and a date that moved without an event is checked again. Fictional people only.
import {
  defaultConfig,
  newId,
  newProperty,
  type DateReminder,
  type DateValue,
  type Property,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import { bindMemoryNotices } from '../notices/testing';
import { syncDefaultWorkspace } from '../workspaces';
import {
  REMINDERS_EVERY_MS,
  REMINDERS_TASK,
  REMINDER_LATE_MS,
  REMINDER_NOTICES,
  reminderTime,
  sendDueReminders,
} from './reminders-task';
import type { DatabaseSettings } from './record';
import { changeDatabase, loadDatabase } from './store';

type Minutes = Extract<DateReminder, { minutesBefore: number }>['minutesBefore'];
type Days = Extract<DateReminder, { daysBefore: number }>['daysBefore'];

/** A date with a time, reminding `minutesBefore` it (no reminder when left out). */
const at = (start: string, minutesBefore?: Minutes): DateValue => ({
  start,
  end: null,
  hasTime: true,
  ...(minutesBefore === undefined ? {} : { reminder: { minutesBefore } }),
});

/** A date without a time, reminding `daysBefore` it at 9:00 AM (no reminder when left out). */
const day = (start: string, daysBefore?: Days): DateValue => ({
  start,
  end: null,
  hasTime: false,
  ...(daysBefore === undefined ? {} : { reminder: { daysBefore } }),
});

const fireAt = (value: DateValue, timeZone: string) => {
  const time = reminderTime(value, timeZone);
  return time === null ? null : new Date(time).toISOString();
};

describe('reminder times and words', () => {
  it('reminds minutes before a time, or days before a date at 9:00 AM in the zone', () => {
    expect(fireAt(at('2030-10-28T15:30:00.000Z', 30), 'America/Denver')).toBe(
      '2030-10-28T15:00:00.000Z',
    );
    expect(fireAt(at('2030-10-28T15:30:00.000Z', 0), 'America/New_York')).toBe(
      '2030-10-28T15:30:00.000Z',
    );
    expect(fireAt(at('2030-10-28T15:30:00.000Z', 2880), 'UTC')).toBe('2030-10-26T15:30:00.000Z');
    expect(fireAt(day('2030-11-15', 7), 'America/Denver')).toBe('2030-11-08T16:00:00.000Z');
    expect(fireAt(day('2030-11-20', 1), 'America/New_York')).toBe('2030-11-19T14:00:00.000Z');
    expect(fireAt(day('2030-11-20', 1), 'America/Los_Angeles')).toBe('2030-11-19T17:00:00.000Z');
    expect(fireAt(day('2030-11-20', 0), 'UTC')).toBe('2030-11-20T09:00:00.000Z');
  });

  it('has no time without a reminder that fits the date', () => {
    expect(fireAt(at('2030-10-28T15:30:00.000Z'), 'UTC')).toBeNull();
    expect(fireAt(day('2030-11-20'), 'UTC')).toBeNull();
    expect(fireAt({ ...day('2030-11-20'), reminder: { minutesBefore: 30 } }, 'UTC')).toBeNull();
    expect(fireAt({ ...at('2030-10-28T15:30:00.000Z'), reminder: { daysBefore: 1 } }, 'UTC')).toBe(
      null,
    );
  });

  it('uses fixed words', () => {
    expect(REMINDER_NOTICES.sender).toBe('Databases');
    expect(REMINDER_NOTICES.title).toBe('Reminder');
    expect(REMINDER_NOTICES.text('Due', 'Nov 20, 2030')).toBe('Due: Nov 20, 2030');
    expect([REMINDERS_TASK, REMINDERS_EVERY_MS, REMINDER_LATE_MS]).toEqual([
      'databases.reminders',
      60_000,
      86_400_000,
    ]);
  });
});

describe.skipIf(!hasDatabase)('date reminders', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let notices: ReturnType<typeof bindMemoryNotices>;
  let workspaceId: string;
  let spaceId: string;
  let visitsId: string;
  let inspectionsId: string;
  /** A Date property only Morgan can see. */
  let payday: Property;
  const people = {} as Record<'admin' | 'sam' | 'jordan' | 'avery' | 'casey', TestUser>;

  const visit = newProperty('Visit', defaultConfig('date'));
  const due = newProperty('Due', defaultConfig('date'));
  const assignee = newProperty('Assignee', defaultConfig('person'));
  const helpers = newProperty('Helpers', defaultConfig('person'));
  const notes = newProperty('Notes', defaultConfig('text'));
  // Inspections: only its row access rule lets the inspector open a row.
  const when = newProperty('When', defaultConfig('date'));
  const inspector = newProperty('Inspector', defaultConfig('person'));

  /** A member (an Admin or an Editor); in the Operations space unless `inSpace` is false. */
  async function person(admin: boolean, name: string, inSpace = true): Promise<TestUser> {
    const user = await createUser(db, { role: admin ? 'admin' : 'editor', name });
    if (inSpace) {
      await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
        VALUES (${spaceId}, 'user', ${user.id})`);
    }
    return user;
  }

  const nameOf = (userId: string) =>
    Object.entries(people).find(([, user]) => user.id === userId)?.[0] ?? userId;

  async function newDatabase(parentId: string, title: string): Promise<string> {
    const res = await injectAs(app, people.admin, {
      method: 'POST',
      url: '/api/databases',
      payload: { parentId, inline: false, title },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function addProperties(databaseId: string, change: Partial<DatabaseSettings>) {
    const current = await loadDatabase(db, databaseId);
    if (!current) throw new Error('The test database is missing.');
    await changeDatabase(db, databaseId, current.version, (record) => ({
      ...change,
      properties: [...record.properties, ...(change.properties ?? [])],
    }));
  }

  async function addRow(
    title: string,
    values: Record<string, unknown>,
    who = people.admin,
    databaseId = visitsId,
  ) {
    const res = await injectAs(app, who, {
      method: 'POST',
      url: `/api/databases/${databaseId}/rows`,
      payload: { title, values },
    });
    expect(res.statusCode).toBe(201);
    await app.events.settled();
    return res.json().id as string;
  }

  async function change(rowId: string, values: Record<string, unknown>, who = people.admin) {
    const res = await injectAs(app, who, {
      method: 'PATCH',
      url: `/api/databases/${visitsId}/rows/${rowId}`,
      payload: { values },
    });
    expect(res.statusCode).toBe(200);
    await app.events.settled();
  }

  async function moveRow(to: 'trash' | 'restore', rowId: string) {
    const res = await injectAs(app, people.admin, {
      method: 'POST',
      url: `/api/databases/${visitsId}/rows/${to}`,
      payload: { rowIds: [rowId] },
    });
    expect(res.statusCode).toBe(200);
    await app.events.settled();
  }

  /** The row's reminder entries as "person property time", sent ones marked. */
  async function entries(rowId: string): Promise<string[]> {
    const { rows } = await db.execute<{
      property_id: string;
      user_id: string;
      fire_at: Date | string;
      sent: boolean;
    }>(sql`
      SELECT property_id, user_id, fire_at, sent_at IS NOT NULL AS sent
      FROM db_reminders WHERE row_id = ${rowId}`);
    const propertyName = (id: string) =>
      [visit, due, when, payday].find((p) => p.id === id)?.name ?? id;
    return rows
      .map((r) => {
        const when = new Date(r.fire_at).toISOString();
        const sent = r.sent ? ' sent' : '';
        return `${nameOf(r.user_id)} ${propertyName(r.property_id)} ${when}${sent}`;
      })
      .sort();
  }

  /** The reminder notices about this row, by person. */
  const remindersAbout = (rowId: string) =>
    notices.store.records
      .filter((n) => n.kind === 'reminder' && n.card?.type === 'page' && n.card.pageId === rowId)
      .map((n) => ({ to: nameOf(n.userId), sender: n.sender, title: n.title, text: n.text }))
      .sort((a, b) => a.to.localeCompare(b.to));

  const reminder = (to: string, text: string) => ({
    to,
    sender: 'Databases',
    title: 'Reminder',
    text,
  });

  const sweep = (time: string) => sendDueReminders(app, new Date(time));

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp());
    notices = bindMemoryNotices();
    workspaceId = (await syncDefaultWorkspace(db)).id;
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Dispatch', 'a0') RETURNING id`);
    people.admin = await person(true, 'Morgan Reyes');
    people.sam = await person(false, 'Sam Ortiz');
    people.jordan = await person(false, 'Jordan Park');
    people.avery = await person(false, 'Avery Lin');
    people.casey = await person(false, 'Casey Brooks', false);
    await db.execute(sql`
      UPDATE users SET time_zone = 'America/New_York' WHERE id = ${people.sam.id}`);
    await db.execute(sql`
      UPDATE users SET time_zone = 'America/Los_Angeles', use_24h = true
      WHERE id = ${people.jordan.id}`);

    payday = {
      ...newProperty('Payday', defaultConfig('date')),
      access: { see: [{ type: 'user', id: people.admin.id }], change: null },
    };
    visitsId = await newDatabase(page.rows[0]!.id, 'Visits');
    await addProperties(visitsId, { properties: [visit, due, assignee, helpers, notes, payday] });
    inspectionsId = await newDatabase(page.rows[0]!.id, 'Inspections');
    await addProperties(inspectionsId, {
      properties: [when, inspector],
      accessRules: [{ id: newId(), propertyId: inspector.id, level: 'view' }],
    });
  });

  afterEach(async () => {
    // Each test reads its own rows' reminders only.
    await db.execute(sql`DELETE FROM db_reminders`);
  });

  afterAll(async () => {
    notices?.unbind();
    await close?.();
  });

  it('reminds the people in the row on time, once, and only those who can open it', async () => {
    const leak = await addRow('Leak under the sink', {
      [visit.id]: at('2030-10-28T15:30:00.000Z', 30),
      [assignee.id]: [people.sam.id, people.casey.id],
      [helpers.id]: [people.jordan.id],
    });
    expect(await entries(leak)).toEqual([
      'casey Visit 2030-10-28T15:00:00.000Z',
      'jordan Visit 2030-10-28T15:00:00.000Z',
      'sam Visit 2030-10-28T15:00:00.000Z',
    ]);

    expect(await sweep('2030-10-28T14:59:59.000Z')).toBe(0);
    expect(await sweep('2030-10-28T15:00:00.000Z')).toBe(2);
    // Each sees the time their own way; Casey isn't in the space, so gets nothing.
    expect(remindersAbout(leak)).toEqual([
      reminder('jordan', 'Visit: Oct 28, 2030 08:30'),
      reminder('sam', 'Visit: Oct 28, 2030 11:30 AM'),
    ]);
    expect(await entries(leak)).toEqual([
      'jordan Visit 2030-10-28T15:00:00.000Z sent',
      'sam Visit 2030-10-28T15:00:00.000Z sent',
    ]);

    // Later runs and saves don't send it again.
    await change(leak, { [assignee.id]: [people.sam.id], [notes.id]: 'Bring a wrench' });
    expect(await sweep('2030-10-28T15:01:00.000Z')).toBe(0);
    expect(await sweep('2030-10-28T15:30:00.000Z')).toBe(0);
    expect(remindersAbout(leak)).toHaveLength(2);
    expect(await entries(leak)).toEqual([
      'jordan Visit 2030-10-28T15:00:00.000Z sent',
      'sam Visit 2030-10-28T15:00:00.000Z sent',
    ]);

    // A day after their time, sent entries go.
    expect(await sweep('2030-10-29T15:00:01.000Z')).toBe(0);
    expect(await entries(leak)).toEqual([]);
  });

  it('reminds someone who can open the row only through a row access rule', async () => {
    // Casey isn't in the space: the rule on Inspector is what opens the row to them.
    const backflow = await addRow(
      'Backflow test',
      { [when.id]: at('2031-03-03T15:00:00.000Z', 10), [inspector.id]: [people.casey.id] },
      people.admin,
      inspectionsId,
    );
    expect(await entries(backflow)).toEqual(['casey When 2031-03-03T14:50:00.000Z']);
    expect(await sweep('2031-03-03T14:50:00.000Z')).toBe(1);
    expect(remindersAbout(backflow)).toEqual([reminder('casey', 'When: Mar 3, 2031 8:00 AM')]);

    // A locked account gets none.
    const valve = await addRow(
      'Valve check',
      { [when.id]: at('2031-03-04T15:00:00.000Z', 10), [inspector.id]: [people.casey.id] },
      people.admin,
      inspectionsId,
    );
    await db.execute(sql`UPDATE users SET locked_at = now() WHERE id = ${people.casey.id}`);
    try {
      expect(await sweep('2031-03-04T14:50:00.000Z')).toBe(0);
      expect(remindersAbout(valve)).toEqual([]);
      expect(await entries(valve)).toEqual([]);
    } finally {
      await db.execute(sql`UPDATE users SET locked_at = NULL WHERE id = ${people.casey.id}`);
    }
  });

  it("drops a reminder whose Date property the person can't see", async () => {
    const payroll = await addRow('Payroll run', {
      [payday.id]: day('2031-04-15', 1),
      [assignee.id]: [people.sam.id, people.admin.id],
    });
    expect(await entries(payroll)).toEqual([
      'admin Payday 2031-04-14T15:00:00.000Z',
      'sam Payday 2031-04-14T13:00:00.000Z',
    ]);
    expect(await sweep('2031-04-14T13:00:00.000Z')).toBe(0);
    expect(await sweep('2031-04-14T15:00:00.000Z')).toBe(1);
    expect(remindersAbout(payroll)).toEqual([reminder('admin', 'Payday: Apr 15, 2031')]);
    expect(await entries(payroll)).toEqual(['admin Payday 2031-04-14T15:00:00.000Z sent']);
  });

  it('reminds whoever set it, at 9:00 AM their time, when the row names nobody', async () => {
    const heater = await addRow('Water heater', { [due.id]: day('2030-11-20', 1) }, people.sam);
    expect(await entries(heater)).toEqual(['sam Due 2030-11-19T14:00:00.000Z']);

    // Jordan changes the reminder, so it's theirs now: 9:00 AM in Los Angeles.
    await change(heater, { [due.id]: day('2030-11-20', 2) }, people.jordan);
    expect(await entries(heater)).toEqual(['jordan Due 2030-11-18T17:00:00.000Z']);

    // Moving the date keeps the reminder Jordan's.
    await change(heater, { [due.id]: day('2030-11-21', 2) }, people.sam);
    expect(await entries(heater)).toEqual(['jordan Due 2030-11-19T17:00:00.000Z']);

    // Once the row names people, they get it instead, each at 9:00 AM their own time.
    await change(heater, { [helpers.id]: [people.sam.id, people.jordan.id] });
    expect(await entries(heater)).toEqual([
      'jordan Due 2030-11-19T17:00:00.000Z',
      'sam Due 2030-11-19T14:00:00.000Z',
    ]);
    expect(await sweep('2030-11-19T14:00:00.000Z')).toBe(1);
    expect(remindersAbout(heater)).toEqual([reminder('sam', 'Due: Nov 21, 2030')]);
    expect(await sweep('2030-11-19T17:00:00.000Z')).toBe(1);
    expect(remindersAbout(heater)).toEqual([
      reminder('jordan', 'Due: Nov 21, 2030'),
      reminder('sam', 'Due: Nov 21, 2030'),
    ]);
  });

  it('drops a reminder for someone who lost access, on a row in Trash, or taken off', async () => {
    const time = at('2030-12-02T16:00:00.000Z', 0);
    const gutter = await addRow('Gutter', { [visit.id]: time, [assignee.id]: [people.avery.id] });
    const fence = await addRow('Fence', { [visit.id]: time, [assignee.id]: [people.sam.id] });
    const porch = await addRow('Porch light', { [visit.id]: time, [assignee.id]: [people.sam.id] });

    // Avery leaves the space, the fence visit goes to Trash and the porch light's reminder is
    // taken off.
    await db.execute(sql`
      DELETE FROM space_members WHERE space_id = ${spaceId} AND principal_id = ${people.avery.id}`);
    await moveRow('trash', fence);
    await change(porch, { [visit.id]: at('2030-12-02T16:00:00.000Z') });
    expect(await entries(gutter)).toEqual(['avery Visit 2030-12-02T16:00:00.000Z']);
    expect(await entries(fence)).toEqual(['sam Visit 2030-12-02T16:00:00.000Z']);
    expect(await entries(porch)).toEqual([]);

    expect(await sweep('2030-12-02T16:00:00.000Z')).toBe(0);
    expect([...remindersAbout(gutter), ...remindersAbout(fence), ...remindersAbout(porch)]).toEqual(
      [],
    );
    expect(await entries(gutter)).toEqual([]);
    expect(await entries(fence)).toEqual([]);

    // Restored from Trash before its date, the row reminds again.
    await moveRow('restore', fence);
    expect(await entries(fence)).toEqual(['sam Visit 2030-12-02T16:00:00.000Z']);
  });

  it('drops a reminder for someone removed from the workspace', async () => {
    const time = at('2030-12-09T16:00:00.000Z', 0);
    const drain = await addRow('Drain', { [visit.id]: time, [assignee.id]: [people.jordan.id] });
    expect(await entries(drain)).toEqual(['jordan Visit 2030-12-09T16:00:00.000Z']);
    await db.execute(sql`
      UPDATE workspace_members SET removed_at = now()
      WHERE workspace_id = ${workspaceId} AND user_id = ${people.jordan.id}`);
    try {
      expect(await sweep('2030-12-09T16:00:00.000Z')).toBe(0);
      expect(remindersAbout(drain)).toEqual([]);
      expect(await entries(drain)).toEqual([]);
    } finally {
      await db.execute(sql`
        UPDATE workspace_members SET removed_at = NULL
        WHERE workspace_id = ${workspaceId} AND user_id = ${people.jordan.id}`);
    }
  });

  it("drops a reminder that's more than a day late", async () => {
    const roof = await addRow('Roof', {
      [visit.id]: at('2030-12-10T14:00:00.000Z', 60),
      [assignee.id]: [people.sam.id],
    });
    const attic = await addRow('Attic', {
      [visit.id]: at('2030-12-10T12:00:00.000Z', 60),
      [assignee.id]: [people.sam.id],
    });

    // The server was down: the next run finds the roof's reminder 23 hours late, the attic's 25.
    expect(await sweep('2030-12-11T12:00:00.000Z')).toBe(1);
    expect(remindersAbout(roof)).toEqual([reminder('sam', 'Visit: Dec 10, 2030 9:00 AM')]);
    expect(remindersAbout(attic)).toEqual([]);
    expect(await entries(attic)).toEqual([]);
  });

  it('checks a date that moved without an event again and reminds at the new time', async () => {
    const boiler = await addRow('Boiler', {
      [visit.id]: at('2031-01-06T15:00:00.000Z', 15),
      [assignee.id]: [people.sam.id],
    });
    expect(await entries(boiler)).toEqual(['sam Visit 2031-01-06T14:45:00.000Z']);
    const later = JSON.stringify(at('2031-01-06T18:00:00.000Z', 15));
    await db.execute(sql`
      UPDATE db_rows
      SET "values" = "values" || jsonb_build_object(${visit.id}::text, ${later}::jsonb)
      WHERE page_id = ${boiler}`);

    expect(await sweep('2031-01-06T14:45:00.000Z')).toBe(0);
    expect(await entries(boiler)).toEqual(['sam Visit 2031-01-06T17:45:00.000Z']);
    expect(await sweep('2031-01-06T17:45:00.000Z')).toBe(1);
    expect(remindersAbout(boiler)).toEqual([reminder('sam', 'Visit: Jan 6, 2031 1:00 PM')]);
  });

  it('sends a reminder once when two runs overlap', async () => {
    const drain = await addRow('Drain', {
      [visit.id]: at('2031-02-03T17:00:00.000Z', 5),
      [assignee.id]: [people.sam.id, people.jordan.id],
    });
    const time = '2031-02-03T16:55:00.000Z';
    const counts = await Promise.all([sweep(time), sweep(time), sweep(time)]);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(remindersAbout(drain).map((n) => n.to)).toEqual(['jordan', 'sam']);
  });
});
