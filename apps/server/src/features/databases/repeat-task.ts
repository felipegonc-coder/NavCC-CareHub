// Repeating database templates (Templates and buttons 3.2, TB-07). Every 15 minutes the task makes
// the row each repeating template owes: one per run, named with the template's name and the run's
// date in its time zone ("Weekly huddle – Oct 26"), made as the person who set the repeat up,
// through createRow with source 'template'. A run missed while Care Hub was down is made once when
// it's back, within 24 hours (the package's dueRuns); a repeat that ends after a number of times
// counts down in the template.
//
// db_repeat_state keeps each repeating template's last run (before the first: when the task first
// saw the schedule) and its next one. It follows the database's templates on every settings save
// (databases.database.updated) and on every run (syncRepeats): new repeats start from then,
// changed ones get their next run again, and the states of templates that stopped repeating go.
//
// When the person who set it up has left the workspace, is locked or can no longer use templates
// in the database, or the row can't be made, the repeat pauses: paused_reason is set, the
// template's repeat shows paused, and the people with Full access on the database get a 🔔
// notice. Saving the repeat with paused off starts it again from then. Each database is one
// transaction with its row locked, so overlapping runs make each row once.
import { titleProperty, type Instant, type RowTemplate } from '@carehub/databases';
import {
  REPEAT_MESSAGES,
  afterRun,
  dueRuns,
  nextRuns,
  repeatTitle,
  shouldPause,
} from '@carehub/databases/repeat';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { registerPeriodicTask } from '../jobs';
import { sendNotice, type SendNoticeInput } from '../notices';
import { getPageAccess } from '../pages';
import { createRow, runRowWrites } from './api';
import { isUuid, type DatabaseRecord } from './record';
import { lockDatabase, saveSettings, type Executor } from './store';

/** The notice to the people with Full access when a repeat pauses (generic words; a card). */
export const REPEAT_NOTICES = {
  sender: 'Databases',
  title: 'Repeating template paused',
  noAccess: REPEAT_MESSAGES.paused,
  failed: "A repeating template was paused because its row couldn't be made.",
} as const;

/** Why a repeat paused (db_repeat_state.paused_reason). */
export const PAUSED_REASONS = {
  /** The person who set it up left, is locked or can no longer use templates in the database. */
  noAccess: 'no_access',
  /** Its row was refused for another reason. */
  failed: 'failed',
} as const;
export type PausedReason = (typeof PAUSED_REASONS)[keyof typeof PAUSED_REASONS];

export const REPEATS_TASK = 'databases.repeats';
export const REPEATS_EVERY_MS = 15 * 60_000;

type StateRow = {
  template_id: string;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  paused_reason: string | null;
};

/** A template's state as the task reads it. */
interface RepeatState {
  templateId: string;
  nextRunAt: Instant | null;
  lastRunAt: Instant | null;
  pausedReason: string | null;
}

interface Paused {
  record: DatabaseRecord;
  reason: PausedReason;
}

const iso = (value: Date | string | null): Instant | null =>
  value === null ? null : new Date(value).toISOString();

const sameTime = (a: Instant | null, b: Instant | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);

const isDue = (state: RepeatState, now: Date) =>
  state.pausedReason === null &&
  state.nextRunAt !== null &&
  Date.parse(state.nextRunAt) <= now.getTime();

/** The later of `now` and the last run. */
const latest = (now: Date, lastRunAt: Instant | null): Instant =>
  lastRunAt !== null && Date.parse(lastRunAt) > now.getTime() ? lastRunAt : now.toISOString();

/** The next run after `after`: none while paused (by a person), out of times or past the end. */
const nextAfter = (template: RowTemplate, after: Instant): Instant | null =>
  !template.repeat || template.repeat.paused
    ? null
    : (nextRuns(template.repeat, after, 1)[0] ?? null);

async function setState(
  tx: Tx,
  record: DatabaseRecord,
  templateId: string,
  state: Pick<RepeatState, 'nextRunAt' | 'lastRunAt' | 'pausedReason'>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE db_repeat_state SET next_run_at = ${state.nextRunAt}::timestamptz,
      last_run_at = ${state.lastRunAt}::timestamptz, paused_reason = ${state.pausedReason}
    WHERE template_id = ${templateId} AND database_id = ${record.id}`);
}

/**
 * Brings the database's repeat states in line with its templates (the database is locked): a
 * repeat without one starts from `now`; a waiting one gets its next run again (the schedule may
 * have changed) and a due one stays due; a paused one whose repeat was turned back on starts again
 * from `now`; states of templates that are gone or no longer repeat are deleted. Nothing changes
 * while the database is in Trash. Answers the states, by template id.
 */
export async function syncRepeats(
  tx: Tx,
  record: DatabaseRecord,
  now: Date,
): Promise<Map<string, RepeatState>> {
  const { rows } = await tx.execute<StateRow>(sql`
    SELECT template_id, next_run_at, last_run_at, paused_reason FROM db_repeat_state
    WHERE database_id = ${record.id} ORDER BY template_id FOR UPDATE`);
  const states = new Map(
    rows.map((r): [string, RepeatState] => [
      r.template_id,
      {
        templateId: r.template_id,
        nextRunAt: iso(r.next_run_at),
        lastRunAt: iso(r.last_run_at),
        pausedReason: r.paused_reason,
      },
    ]),
  );
  if (record.inTrash) return states;
  const kept = new Set<string>();
  for (const template of record.templates) {
    if (!template.repeat) continue;
    kept.add(template.id);
    const state = states.get(template.id);
    const since = latest(now, state?.lastRunAt ?? null);
    const next = nextAfter(template, since);
    if (!state) {
      const { rows: added } = await tx.execute<{ template_id: string }>(sql`
        INSERT INTO db_repeat_state (template_id, database_id, next_run_at, last_run_at)
        VALUES (${template.id}, ${record.id}, ${next}::timestamptz, ${since}::timestamptz)
        ON CONFLICT (template_id) DO NOTHING RETURNING template_id`);
      if (added.length > 0) {
        const fresh = { nextRunAt: next, lastRunAt: since, pausedReason: null };
        states.set(template.id, { templateId: template.id, ...fresh });
      }
      continue;
    }
    if (state.pausedReason !== null) {
      if (template.repeat.paused) continue;
      Object.assign(state, { nextRunAt: next, lastRunAt: since, pausedReason: null });
      await setState(tx, record, template.id, state);
      continue;
    }
    if (isDue(state, now) || sameTime(state.nextRunAt, next)) continue;
    state.nextRunAt = next;
    await setState(tx, record, template.id, state);
  }
  const gone = [...states.keys()].filter((id) => !kept.has(id));
  if (gone.length > 0) {
    const ids = sql.join(
      gone.map((id) => sql`${id}`),
      sql`, `,
    );
    await tx.execute(sql`
      DELETE FROM db_repeat_state WHERE database_id = ${record.id} AND template_id IN (${ids})`);
    for (const id of gone) states.delete(id);
  }
  return states;
}

/** In a transaction: the database, locked; null when it's gone. */
async function lockIfThere(tx: Tx, id: string): Promise<DatabaseRecord | null> {
  try {
    return await lockDatabase(tx, id);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Whether the person a repeat runs as can still make its rows: a member of the workspace (not a
 * guest), not locked, with their level on the database.
 */
async function ownerOf(tx: Tx, record: DatabaseRecord, ownerId: string) {
  if (!isUuid(ownerId)) return { active: false, access: null };
  const { rows } = await tx.execute<{ user_id: string }>(sql`
    SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${record.workspaceId} AND m.user_id = ${ownerId}
      AND m.kind = 'member' AND u.locked_at IS NULL`);
  if (rows.length === 0) return { active: false, access: null };
  return { active: true, access: await getPageAccess(tx, ownerId, record.id) };
}

/** The template with its repeat changed. */
const withRepeat = (
  templates: readonly RowTemplate[],
  id: string,
  change: (repeat: NonNullable<RowTemplate['repeat']>) => RowTemplate['repeat'],
): RowTemplate[] =>
  templates.map((t) => (t.id === id && t.repeat ? { ...t, repeat: change(t.repeat) } : t));

/**
 * One database's repeats at `now`, in one transaction with the database locked: syncs the states,
 * then makes each due template's row (or pauses it). Answers the rows made and the pauses.
 */
async function runDatabase(app: FastifyInstance, databaseId: string, now: Date) {
  return runRowWrites(app, async (tx) => {
    const outcome = { made: 0, paused: [] as Paused[] };
    const record = await lockIfThere(tx, databaseId);
    if (!record || record.inTrash) return outcome;
    const states = await syncRepeats(tx, record, now);
    const nameId = titleProperty(record.properties).id;
    let templates = record.templates;
    const pause = async (state: RepeatState, reason: PausedReason) => {
      await setState(tx, record, state.templateId, {
        nextRunAt: null,
        lastRunAt: state.lastRunAt,
        pausedReason: reason,
      });
      templates = withRepeat(templates, state.templateId, (r) => ({ ...r, paused: true }));
      outcome.paused.push({ record, reason });
    };
    for (const state of states.values()) {
      const template = templates.find((t) => t.id === state.templateId);
      const schedule = template?.repeat;
      if (!template || !schedule || !isDue(state, now)) continue;
      const due = dueRuns(schedule, state.lastRunAt, now);
      if (due.run === null) {
        await setState(tx, record, template.id, { ...state, nextRunAt: due.next });
        continue;
      }
      if (shouldPause(await ownerOf(tx, record, schedule.ownerId))) {
        await pause(state, PAUSED_REASONS.noAccess);
        continue;
      }
      try {
        await createRow(tx, {
          databaseId: record.id,
          templateId: template.id,
          values: { [nameId]: repeatTitle(template.name, due.run, schedule.timeZone) },
          actorUserId: schedule.ownerId,
          source: 'template',
        });
      } catch (err) {
        if (!(err instanceof HttpError) || err.statusCode >= 500) throw err;
        await pause(
          state,
          err.statusCode === 403 ? PAUSED_REASONS.noAccess : PAUSED_REASONS.failed,
        );
        continue;
      }
      await setState(tx, record, template.id, {
        ...state,
        lastRunAt: due.run,
        nextRunAt: due.next,
      });
      if ((schedule.timesLeft ?? null) !== null) {
        templates = withRepeat(templates, template.id, afterRun);
      }
      outcome.made += 1;
    }
    if (templates !== record.templates) await saveSettings(tx, record, { templates });
    return outcome;
  });
}

/** The workspace members (not guests or locked accounts) with Full access on the database. */
async function fullAccessPeople(db: Executor, record: DatabaseRecord): Promise<string[]> {
  const { rows } = await db.execute<{ user_id: string }>(sql`
    SELECT m.user_id FROM workspace_members m JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = ${record.workspaceId} AND m.kind = 'member' AND u.locked_at IS NULL
    ORDER BY m.user_id`);
  const people: string[] = [];
  for (const { user_id } of rows) {
    if ((await getPageAccess(db, user_id, record.id)) === 'full') people.push(user_id);
  }
  return people;
}

/** Tells the people with Full access on the database that a repeat paused. */
async function sendPausedNotices(app: Pick<FastifyInstance, 'db' | 'log'>, paused: Paused) {
  const { record, reason } = paused;
  for (const userId of await fullAccessPeople(app.db, record)) {
    const notice: SendNoticeInput = {
      workspaceId: record.workspaceId,
      userId,
      kind: 'alert',
      sender: REPEAT_NOTICES.sender,
      title: REPEAT_NOTICES.title,
      text: reason === PAUSED_REASONS.noAccess ? REPEAT_NOTICES.noAccess : REPEAT_NOTICES.failed,
      card: { type: 'page', pageId: record.id },
    };
    try {
      await sendNotice(notice);
    } catch (err) {
      app.log.warn({ err }, 'databases: a repeat paused notice was not sent');
    }
  }
}

/** The databases (not in Trash) with repeating templates or repeat states. */
async function repeatingDatabases(db: Executor): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT d.page_id AS id FROM db_databases d JOIN pages p ON p.id = d.page_id
    WHERE p.deleted_at IS NULL AND (
      jsonb_path_exists(d.templates, '$[*].repeat ? (@.type() == "object")')
      OR EXISTS (SELECT 1 FROM db_repeat_state s WHERE s.database_id = d.page_id))
    ORDER BY d.page_id`);
  return rows.map((r) => r.id);
}

/**
 * Makes the rows repeating templates owe at `now`, each once, and pauses the ones that can't run.
 * Returns how many rows were made.
 */
export async function runRepeats(
  app: FastifyInstance,
  now: Date = new Date(),
  signal?: AbortSignal,
): Promise<number> {
  let made = 0;
  for (const databaseId of await repeatingDatabases(app.db)) {
    if (signal?.aborted) break;
    try {
      const outcome = await runDatabase(app, databaseId, now);
      made += outcome.made;
      for (const paused of outcome.paused) await sendPausedNotices(app, paused);
    } catch (err) {
      app.log.warn({ err }, 'databases: repeating templates did not run');
    }
  }
  return made;
}

/** Syncs one database's repeat states after a settings save. */
export async function syncDatabaseRepeats(
  db: Db,
  databaseId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(databaseId)) return;
  await db.transaction(async (tx) => {
    const record = await lockIfThere(tx, databaseId);
    if (record) await syncRepeats(tx, record, now);
  });
}

/** The app whose repeats run: tests start many apps, and the task follows the latest one. */
let running: FastifyInstance | null = null;

/** Keeps repeat states in step with settings saves, and runs the repeats every 15 minutes. */
export function registerRepeats(app: FastifyInstance): void {
  const stop = app.events.on('databases.database.updated', async (event) => {
    try {
      await syncDatabaseRepeats(app.db, event.databaseId);
    } catch (err) {
      app.log.warn({ err }, 'databases: repeat states were not updated');
    }
  });
  running = app;
  registerPeriodicTask(REPEATS_TASK, REPEATS_EVERY_MS, async ({ signal }) => {
    if (running === app) await runRepeats(app, new Date(), signal);
  });
  app.addHook('onClose', async () => {
    stop();
    if (running === app) running = null;
  });
}
