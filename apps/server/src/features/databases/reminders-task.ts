// Date reminders (decision 0200; Databases spec, Date and DB-43). A Date value with a reminder
// sends a 🔔 notice to the people in the row's Person properties, or to the person who set the
// reminder when there are none: some minutes before a date with a time, or at 9:00 AM in each
// person's own time zone some days before a date without one. Row events (after the commit)
// refresh the row's coming reminders in db_reminders, one entry per person; a task every minute
// sends the due ones to the people who can still open the row. Each entry is checked and marked
// sent in one transaction, and the notice goes after the commit, so a reminder fires once.
import {
  DEFAULT_TIME_ZONE,
  addDays,
  findProperty,
  formatDateValue,
  isValidDateValue,
  isValidTimeZone,
  zonedToInstant,
  type DateValue,
  type Property,
  type Row,
} from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db, Tx } from '../../db';
import { registerPeriodicTask } from '../jobs';
import { NOTICE_LIMITS, sendNotice, type SendNoticeInput } from '../notices';
import { getAccessForPages } from '../pages';
import type { RowUpdatedEvent } from './events';
import { isUuid, type DatabaseRecord } from './record';
import { loadDatabase, loadRows, uuidList, type Executor } from './store';

/** A reminder's notice: generic words, the Date property's name and when, and the row's card. */
export const REMINDER_NOTICES = {
  sender: 'Databases',
  title: 'Reminder',
  text: (property: string, when: string) => `${property}: ${when}`,
} as const;

export const REMINDERS_TASK = 'databases.reminders';
export const REMINDERS_EVERY_MS = 60_000;
/** A reminder found more than this late (the server was down) is dropped instead of sent. */
export const REMINDER_LATE_MS = 24 * 60 * 60_000;
/** Dates without a time remind at this hour in each person's time zone. */
const DAY_REMINDER_HOUR = 9;
/** Due entries checked per transaction, and transactions per run at most. */
const BATCH = 200;
const BATCHES = 25;

/** One reminder a row asks for: a Date property, the person it goes to and when (ms). */
export interface WantedReminder {
  propertyId: string;
  userId: string;
  fireAt: number;
}

interface Person {
  timeZone: string;
  hour12: boolean;
}

const iso = (ms: number | Date) => new Date(ms).toISOString();

/**
 * When a reminder on this value fires for someone in `timeZone` (ms), or null without one. A date
 * with a time: minutes before its start. A date without one: days before, at 9:00 AM there.
 */
export function reminderTime(value: DateValue, timeZone: string): number | null {
  const r = value.reminder;
  if (!r) return null;
  if (value.hasTime) {
    if (!('minutesBefore' in r) || typeof r.minutesBefore !== 'number') return null;
    return Date.parse(value.start) - r.minutesBefore * 60_000;
  }
  if (!('daysBefore' in r) || typeof r.daysBefore !== 'number') return null;
  const day = addDays(value.start, -r.daysBefore);
  return Date.parse(zonedToInstant(day, DAY_REMINDER_HOUR, 0, timeZone));
}

/** The row's Date values that have a reminder. */
function remindingDates(record: DatabaseRecord, row: Row) {
  return record.properties.flatMap((prop) => {
    const value = row.values[prop.id];
    if (prop.config.type !== 'date' || !isValidDateValue(value) || !value.reminder) return [];
    return [{ prop, value }];
  });
}

/** Everyone in the row's Person properties. */
function peopleInRow(record: DatabaseRecord, row: Row): string[] {
  const ids = new Set<string>();
  for (const prop of record.properties) {
    const value = row.values[prop.id];
    if (prop.config.type !== 'person' || !Array.isArray(value)) continue;
    for (const id of value) if (isUuid(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Who set the reminder on this Date value: the latest change in the row's history that set or
 * changed it (moving the date keeps the reminder's owner), or the row's creator.
 */
async function setterOf(db: Executor, row: Row, propertyId: string): Promise<string | null> {
  const { rows } = await db.execute<{ by: string | null }>(sql`
    SELECT "by" FROM db_row_changes
    WHERE row_id = ${row.id} AND property_id = ${propertyId}
      AND "after" -> 'reminder' IS NOT NULL
      AND "before" -> 'reminder' IS DISTINCT FROM "after" -> 'reminder'
    ORDER BY "at" DESC, id DESC
    LIMIT 1`);
  const latest = rows[0];
  return latest ? latest.by : row.createdBy;
}

async function loadPeople(db: Executor, ids: readonly string[]): Promise<Map<string, Person>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<{ id: string; time_zone: string; use_24h: boolean }>(sql`
    SELECT id, time_zone, use_24h FROM users WHERE id = ANY(${uuidList(ids)})`);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        timeZone: isValidTimeZone(r.time_zone) ? r.time_zone : DEFAULT_TIME_ZONE,
        hour12: !r.use_24h,
      },
    ]),
  );
}

/** Every reminder the row's values ask for, for each person it goes to, with those people. */
export async function wantedReminders(db: Executor, record: DatabaseRecord, row: Row) {
  const dates = remindingDates(record, row);
  if (dates.length === 0) return { wanted: [], people: new Map<string, Person>() };
  const inRow = peopleInRow(record, row);
  const recipients = new Map<string, string[]>();
  for (const { prop } of dates) {
    const setter = inRow.length ? null : await setterOf(db, row, prop.id);
    recipients.set(prop.id, inRow.length ? inRow : setter ? [setter] : []);
  }
  const people = await loadPeople(db, [...new Set([...recipients.values()].flat())]);
  const wanted: WantedReminder[] = dates.flatMap(({ prop, value }) =>
    (recipients.get(prop.id) ?? []).flatMap((userId) => {
      const person = people.get(userId);
      const fireAt = person ? reminderTime(value, person.timeZone) : null;
      return fireAt === null || !Number.isFinite(fireAt)
        ? []
        : [{ propertyId: prop.id, userId, fireAt }];
    }),
  );
  return { wanted, people };
}

/**
 * Recomputes a row's coming reminders from its values. Due ones that haven't gone yet stay for the
 * task, which checks them again. A row in Trash or gone keeps its entries until they come due.
 */
export async function refreshReminders(
  db: Db,
  databaseId: string,
  rowId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(databaseId) || !isUuid(rowId)) return;
  // Most databases have no dates: nothing to do (entries of a deleted Date property drop when due).
  const settings = await loadDatabase(db, databaseId);
  if (!settings?.properties.some((p) => p.config.type === 'date')) return;
  await db.transaction(async (tx) => {
    // One refresh per row at a time, so two quick edits can't leave both sets behind.
    const key = `databases.reminders:${rowId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const record = await loadDatabase(tx, databaseId);
    const [row] = record && !record.inTrash ? await loadRows(tx, databaseId, [rowId]) : [];
    if (!record || !row) return;
    const { wanted } = await wantedReminders(tx, record, row);
    const coming = wanted.filter((w) => w.fireAt > now.getTime());
    await tx.execute(sql`
      DELETE FROM db_reminders
      WHERE row_id = ${rowId} AND sent_at IS NULL AND fire_at > ${iso(now)}::timestamptz`);
    if (coming.length === 0) return;
    const values = coming.map(
      (w) =>
        sql`(${rowId}::uuid, ${w.propertyId}, ${w.userId}::uuid, ${iso(w.fireAt)}::timestamptz)`,
    );
    await tx.execute(sql`
      INSERT INTO db_reminders (row_id, property_id, user_id, fire_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT DO NOTHING`);
  });
}

/** Whether an update changed something reminders depend on: a Date or a Person value. */
async function touchesReminders(db: Executor, event: RowUpdatedEvent): Promise<boolean> {
  const record = await loadDatabase(db, event.databaseId);
  if (!record) return false;
  return event.propertyIds.some((id) => {
    const type = findProperty(record.properties, id)?.config.type;
    return type === 'date' || type === 'person';
  });
}

/** A due reminder's notice, with the date as this person sees it. */
function reminderNotice(
  record: DatabaseRecord,
  row: Row,
  prop: Property,
  value: DateValue,
  userId: string,
  person: Person,
  now: Date,
): SendNoticeInput {
  const viewer = { timeZone: person.timeZone, hour12: person.hour12, now };
  const when = formatDateValue(value, { format: 'full', viewer });
  return {
    workspaceId: record.workspaceId,
    userId,
    kind: 'reminder',
    sender: REMINDER_NOTICES.sender,
    title: REMINDER_NOTICES.title,
    text: REMINDER_NOTICES.text(prop.name, when).slice(0, NOTICE_LIMITS.text),
    card: { type: 'page', pageId: row.id },
  };
}

type DueRow = {
  id: string;
  row_id: string;
  property_id: string;
  user_id: string;
  database_id: string;
};

interface Taken {
  notices: SendNoticeInput[];
  /** Rows whose reminders moved later: refreshed after the commit. */
  refresh: Map<string, string>;
  full: boolean;
}

/**
 * Takes up to one batch of due entries: each is sent (marked sent here) when the row still asks
 * for it, it's at most a day late and its person can open the row; otherwise it's dropped.
 */
async function takeDue(tx: Tx, now: Date): Promise<Taken> {
  const { rows: due } = await tx.execute<DueRow>(sql`
    SELECT r.id, r.row_id, r.property_id, r.user_id, d.database_id
    FROM db_reminders r JOIN db_rows d ON d.page_id = r.row_id
    WHERE r.sent_at IS NULL AND r.fire_at <= ${iso(now)}::timestamptz
    ORDER BY r.fire_at, r.id
    LIMIT ${BATCH}
    FOR UPDATE OF r SKIP LOCKED`);
  const sent: string[] = [];
  const dropped: string[] = [];
  const taken: Taken = { notices: [], refresh: new Map(), full: due.length === BATCH };
  const byRow = new Map<string, DueRow[]>();
  for (const entry of due) byRow.set(entry.row_id, [...(byRow.get(entry.row_id) ?? []), entry]);
  const records = new Map<string, DatabaseRecord | null>();

  for (const [rowId, entries] of byRow) {
    const databaseId = entries[0]?.database_id ?? '';
    if (!records.has(databaseId)) records.set(databaseId, await loadDatabase(tx, databaseId));
    const record = records.get(databaseId);
    const [row] = record && !record.inTrash ? await loadRows(tx, databaseId, [rowId]) : [];
    if (!record || !row) {
      dropped.push(...entries.map((e) => e.id));
      continue;
    }
    const { wanted, people } = await wantedReminders(tx, record, row);
    const done = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.property_id}:${entry.user_id}`;
      const want = wanted.find(
        (w) => w.propertyId === entry.property_id && w.userId === entry.user_id,
      );
      const person = people.get(entry.user_id);
      const prop = findProperty(record.properties, entry.property_id);
      const value = prop ? row.values[prop.id] : undefined;
      if (!want || !person || !prop || !isValidDateValue(value) || done.has(key)) {
        dropped.push(entry.id);
        continue;
      }
      if (want.fireAt > now.getTime()) {
        // The date moved later: its new entry comes with a refresh.
        dropped.push(entry.id);
        taken.refresh.set(rowId, databaseId);
        continue;
      }
      const levels = await getAccessForPages(tx, entry.user_id, [rowId]);
      if (now.getTime() - want.fireAt > REMINDER_LATE_MS || !atLeast(levels.get(rowId), 'view')) {
        dropped.push(entry.id);
        continue;
      }
      done.add(key);
      sent.push(entry.id);
      taken.notices.push(reminderNotice(record, row, prop, value, entry.user_id, person, now));
    }
  }
  if (dropped.length) {
    await tx.execute(sql`DELETE FROM db_reminders WHERE id = ANY(${uuidList(dropped)})`);
  }
  if (sent.length) {
    await tx.execute(sql`
      UPDATE db_reminders SET sent_at = ${iso(now)}::timestamptz WHERE id = ANY(${uuidList(sent)})`);
  }
  return taken;
}

/** Sends the reminders due at `now`, each once. Returns how many notices went out. */
export async function sendDueReminders(
  app: Pick<FastifyInstance, 'db' | 'log'>,
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<number> {
  let count = 0;
  for (let batch = 0; batch < BATCHES && !signal?.aborted; batch += 1) {
    const taken = await app.db.transaction((tx) => takeDue(tx, now));
    for (const notice of taken.notices) {
      try {
        await sendNotice(notice);
        count += 1;
      } catch (err) {
        app.log.warn({ err }, 'databases: a date reminder was not sent');
      }
    }
    for (const [rowId, databaseId] of taken.refresh) {
      await refreshReminders(app.db, databaseId, rowId, now);
    }
    if (!taken.full) break;
  }
  return count;
}

/** The app whose reminders run: tests start many apps, and the task follows the latest one. */
let running: FastifyInstance | null = null;

/**
 * Refreshes a row's reminders after each row event that can change them, and sends the due ones
 * every minute while this app runs.
 */
export function registerReminders(app: FastifyInstance): void {
  const refresh = (databaseId: string, rowId: string) =>
    refreshReminders(app.db, databaseId, rowId);
  const stops = [
    app.events.on('databases.row.created', (event) => refresh(event.databaseId, event.rowId)),
    app.events.on('databases.row.updated', async (event) => {
      if (await touchesReminders(app.db, event)) await refresh(event.databaseId, event.rowId);
    }),
    app.events.on('databases.row.restored', async (event) => {
      for (const rowId of event.rowIds) await refresh(event.databaseId, rowId);
    }),
  ];
  running = app;
  registerPeriodicTask(REMINDERS_TASK, REMINDERS_EVERY_MS, async ({ signal }) => {
    if (running === app) await sendDueReminders(app, new Date(), signal);
  });
  app.addHook('onClose', async () => {
    for (const stop of stops) stop();
    if (running === app) running = null;
  });
}
