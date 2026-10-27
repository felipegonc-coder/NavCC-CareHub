// Reminders in Postgres: migrations/202610270420_reminders_reminders.sql.
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import type { ReminderChanges, ReminderStore } from './service';
import {
  REMINDER_STATUSES,
  type Reminder,
  type ReminderStatus,
  type ReminderTarget,
} from './types';

interface Row {
  id: string;
  workspace_id: string;
  user_id: string;
  target_type: 'page' | 'event';
  page_id: string | null;
  event_id: string | null;
  occurrence_start: string | null;
  minutes_before: number | null;
  due_at: Date | string;
  note: string;
  status: ReminderStatus;
  time_zone: string;
  use_24h: boolean;
  sent_at: Date | string | null;
  created_at: Date | string;
}

/** The one call the store needs from `app.db` or a transaction. */
interface SqlExecutor {
  execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
}

const COLUMNS = sql.raw(`id, workspace_id, user_id, target_type, page_id, event_id,
  occurrence_start, minutes_before, due_at, note, status, time_zone, use_24h, sent_at, created_at`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Timestamps may come back as text (Drizzle's node-postgres driver) or as Dates.
const date = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const iso = (value: Date) => value.toISOString();

function toReminder(row: Row): Reminder {
  const { page_id: pageId, event_id: eventId, occurrence_start: occurrenceStart } = row;
  const target: ReminderTarget =
    row.target_type === 'page'
      ? { type: 'page', pageId: pageId ?? '' }
      : { type: 'event', eventId: eventId ?? '', ...(occurrenceStart ? { occurrenceStart } : {}) };
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    target,
    minutesBefore: row.minutes_before === null ? null : Number(row.minutes_before),
    dueAt: date(row.due_at),
    note: row.note,
    status: row.status,
    timeZone: row.time_zone,
    use24h: row.use_24h,
    sentAt: row.sent_at === null ? null : date(row.sent_at),
    createdAt: date(row.created_at),
  };
}

async function run(db: Db | Tx, statement: SQL): Promise<unknown[]> {
  const executor: SqlExecutor = db;
  return (await executor.execute(statement)).rows;
}

const query = async (db: Db | Tx, statement: SQL) =>
  ((await run(db, statement)) as Row[]).map(toReminder);

function targetColumns(target: ReminderTarget) {
  return target.type === 'page'
    ? { type: 'page', pageId: target.pageId, eventId: null, occurrenceStart: null }
    : {
        type: 'event',
        pageId: null,
        eventId: target.eventId,
        occurrenceStart: target.occurrenceStart ?? null,
      };
}

/** `status IN (…)` from the known statuses only. */
function statusIn(statuses: readonly ReminderStatus[]): SQL {
  const known = REMINDER_STATUSES.filter((status) => statuses.includes(status));
  return sql.raw(`status IN (${known.map((status) => `'${status}'`).join(', ') || 'NULL'})`);
}

function assignments(changes: ReminderChanges): SQL[] {
  const set: SQL[] = [];
  const { target, dueAt, minutesBefore, note, status, timeZone, use24h, sentAt } = changes;
  if (target) {
    const t = targetColumns(target);
    set.push(sql`target_type = ${t.type}, page_id = ${t.pageId}::uuid, event_id = ${t.eventId},
      occurrence_start = ${t.occurrenceStart}`);
  }
  if (dueAt) set.push(sql`due_at = ${iso(dueAt)}::timestamptz`);
  if (minutesBefore !== undefined) set.push(sql`minutes_before = ${minutesBefore}::int`);
  if (note !== undefined) set.push(sql`note = ${note}`);
  if (status) set.push(sql`status = ${status}`);
  if (timeZone) set.push(sql`time_zone = ${timeZone}`);
  if (use24h !== undefined) set.push(sql`use_24h = ${use24h}::boolean`);
  if (sentAt !== undefined) set.push(sql`sent_at = ${sentAt && iso(sentAt)}::timestamptz`);
  return set;
}

export const postgresReminderStore: ReminderStore = {
  async insert(db, reminder, limit, now) {
    const { workspaceId, userId, minutesBefore, dueAt, note, timeZone, use24h } = reminder;
    const t = targetColumns(reminder.target);
    // One at a time per person (inside the caller's transaction), so two can't pass the limit.
    await run(db, sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reminders:${userId}`}, 0))`);
    const [created] = await query(
      db,
      sql`INSERT INTO reminders_reminders (workspace_id, user_id, target_type, page_id, event_id,
          occurrence_start, minutes_before, due_at, note, time_zone, use_24h, created_at)
        SELECT ${workspaceId}::uuid, ${userId}::uuid, ${t.type}, ${t.pageId}::uuid, ${t.eventId},
          ${t.occurrenceStart}, ${minutesBefore}::int, ${iso(dueAt)}::timestamptz, ${note},
          ${timeZone}, ${use24h}::boolean, ${iso(now)}::timestamptz
        WHERE (SELECT count(*) FROM reminders_reminders
          WHERE user_id = ${userId}::uuid AND workspace_id = ${workspaceId}::uuid
            AND status IN ('pending', 'snoozed')) < ${limit}::int
        RETURNING ${COLUMNS}`,
    );
    return created ?? null;
  },

  async get(db, id) {
    if (!UUID.test(id)) return null;
    const [reminder] = await query(
      db,
      sql`SELECT ${COLUMNS} FROM reminders_reminders WHERE id = ${id}::uuid`,
    );
    return reminder ?? null;
  },

  listForOwner: (db, { userId, workspaceId }, sentSince) =>
    query(
      db,
      sql`SELECT ${COLUMNS} FROM reminders_reminders
        WHERE user_id = ${userId}::uuid AND workspace_id = ${workspaceId}::uuid
          AND (status IN ('pending', 'snoozed')
            OR (status IN ('sent', 'done') AND sent_at >= ${iso(sentSince)}::timestamptz))`,
    ),

  listForEvent: (db, eventId) =>
    query(
      db,
      sql`SELECT ${COLUMNS} FROM reminders_reminders
        WHERE event_id = ${eventId} AND status <> 'deleted'`,
    ),

  async update(db, id, changes, when) {
    const set = assignments(changes);
    if (!UUID.test(id) || set.length === 0) return null;
    const due = when.dueAt ? sql` AND due_at = ${iso(when.dueAt)}::timestamptz` : sql``;
    const [updated] = await query(
      db,
      sql`UPDATE reminders_reminders SET ${sql.join(set, sql`, `)}
        WHERE id = ${id}::uuid AND ${statusIn(when.status)}${due}
        RETURNING ${COLUMNS}`,
    );
    return updated ?? null;
  },
};
