// The Status page tables (migration 202610270043_status_tables.sql). Raw SQL returns times as
// epoch numbers (milliseconds, or whole minutes for heartbeats), so no driver date parsing is
// involved.
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import type { IncidentCause, PreviousRun } from './domain/incidents';
import type { Part, PartState } from './domain/overall';
import { MINUTE_MS } from './domain/time';
import type { MinuteSpan } from './domain/uptime';

type Database = Db | Tx;

async function select<Row>(db: Database, query: SQL): Promise<Row[]> {
  const result = await db.execute(query);
  return result.rows as unknown as Row[];
}

const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const minuteAt = (minute: number) => sql`to_timestamp(${minute * 60})`;
const fromMs = (ms: number | null) => (ms === null ? null : new Date(ms));

/** One part's check result, as saved and shown to site admins. */
export interface PartCheck {
  part: Part;
  state: PartState;
  /** What's wrong, in plain words; null when there's nothing to say. */
  message: string | null;
  /** Small facts, such as free disk space. Never names or secrets. */
  facts: Record<string, unknown>;
}

export interface SavedCheck extends PartCheck {
  checkedAt: Date;
  /** When the part entered this state. */
  since: Date;
}

export interface ServerInfo {
  installedAt: Date;
  version: string;
  buildDate: Date | null;
  /** When this version first started: the last update. */
  versionSince: Date;
}

export interface Incident {
  start: Date;
  end: Date;
  cause: IncidentCause;
}

/**
 * Records that this server run started, and returns how the previous run ended. The first run
 * ever is the installation; a new version number is an update.
 */
export async function startRun(
  db: Database,
  run: { at: Date; version: string; buildDate: Date | null },
): Promise<{ installedAt: Date; previous: PreviousRun | null }> {
  const buildDate = run.buildDate ? at(run.buildDate) : sql`NULL::timestamptz`;
  const [row] = await select<{
    installed_ms: number;
    previous_version: string | null;
    stopped_cleanly: boolean | null;
  }>(
    db,
    sql`WITH previous AS (
          SELECT version, stopped_at IS NOT NULL AND stopped_at >= started_at AS stopped_cleanly
          FROM status_server WHERE id = 1
        ), saved AS (
          INSERT INTO status_server AS s
            (id, installed_at, version, build_date, version_since, started_at, stopped_at)
          VALUES (1, ${at(run.at)}, ${run.version}, ${buildDate}, ${at(run.at)}, ${at(run.at)}, NULL)
          ON CONFLICT (id) DO UPDATE SET
            version = EXCLUDED.version,
            build_date = EXCLUDED.build_date,
            version_since = CASE WHEN s.version = EXCLUDED.version
              THEN s.version_since ELSE EXCLUDED.version_since END,
            started_at = EXCLUDED.started_at,
            stopped_at = NULL
          RETURNING (extract(epoch FROM installed_at) * 1000)::float8 AS installed_ms
        )
        SELECT saved.installed_ms, previous.version AS previous_version, previous.stopped_cleanly
        FROM saved LEFT JOIN previous ON true`,
  );
  if (!row) throw new Error('The server run was not saved.');
  const previous =
    row.previous_version === null
      ? null
      : { version: row.previous_version, stoppedCleanly: row.stopped_cleanly === true };
  return { installedAt: new Date(row.installed_ms), previous };
}

/** Marks an orderly shutdown, so the next start can tell a restart from a crash. */
export async function markStopped(db: Database, stoppedAt: Date): Promise<void> {
  await db.execute(sql`UPDATE status_server SET stopped_at = ${at(stoppedAt)} WHERE id = 1`);
}

export async function getServerInfo(db: Database): Promise<ServerInfo | null> {
  const [row] = await select<{
    installed_ms: number;
    version: string;
    build_ms: number | null;
    since_ms: number;
  }>(
    db,
    sql`SELECT (extract(epoch FROM installed_at) * 1000)::float8 AS installed_ms, version,
          (extract(epoch FROM build_date) * 1000)::float8 AS build_ms,
          (extract(epoch FROM version_since) * 1000)::float8 AS since_ms
        FROM status_server WHERE id = 1`,
  );
  if (!row) return null;
  return {
    installedAt: new Date(row.installed_ms),
    version: row.version,
    buildDate: fromMs(row.build_ms),
    versionSince: new Date(row.since_ms),
  };
}

/**
 * Records the heartbeat of `minute` (an epoch minute). Returns whether it's new and the latest
 * earlier heartbeat, so the caller can see a gap.
 */
export async function recordHeartbeat(
  db: Database,
  minute: number,
): Promise<{ inserted: boolean; previous: number | null }> {
  const [row] = await select<{ inserted: number; previous: number | null }>(
    db,
    sql`WITH saved AS (
          INSERT INTO status_heartbeats (minute) VALUES (${minuteAt(minute)})
          ON CONFLICT DO NOTHING RETURNING minute
        )
        SELECT (SELECT count(*) FROM saved)::int AS inserted,
          (SELECT floor(extract(epoch FROM max(minute)) / 60)::int FROM status_heartbeats
            WHERE minute < ${minuteAt(minute)}) AS previous`,
  );
  return { inserted: (row?.inserted ?? 0) > 0, previous: row?.previous ?? null };
}

/** The runs of consecutive heartbeat minutes since `fromMinute`, oldest first. */
export async function listUpSpans(db: Database, fromMinute: number): Promise<MinuteSpan[]> {
  const rows = await select<{ first_minute: number; next_minute: number }>(
    db,
    sql`SELECT min(m)::int AS first_minute, (max(m) + 1)::int AS next_minute
        FROM (
          SELECT m, m - row_number() OVER (ORDER BY m) AS island
          FROM (
            SELECT floor(extract(epoch FROM minute) / 60)::int AS m FROM status_heartbeats
            WHERE minute >= ${minuteAt(fromMinute)}
          ) AS beats
        ) AS numbered
        GROUP BY island
        ORDER BY 1`,
  );
  return rows.map((row) => ({ start: row.first_minute, end: row.next_minute }));
}

/** Deletes heartbeats from before `cutoff` (they're kept for 35 days). */
export async function pruneHeartbeats(db: Database, cutoff: Date): Promise<void> {
  await db.execute(sql`DELETE FROM status_heartbeats WHERE minute < ${at(cutoff)}`);
}

/** Records a gap in the heartbeats, [start, end) in epoch minutes. Recording it twice is a no-op. */
export async function recordIncident(
  db: Database,
  gap: MinuteSpan & { cause: IncidentCause },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO status_incidents (started_at, ended_at, cause)
        VALUES (${minuteAt(gap.start)}, ${minuteAt(gap.end)}, ${gap.cause})
        ON CONFLICT (started_at) DO NOTHING`,
  );
}

/** Incidents that ended after `since`, newest first. */
export async function listIncidents(db: Database, since: Date): Promise<Incident[]> {
  const rows = await select<{ start_ms: number; end_ms: number; cause: IncidentCause }>(
    db,
    sql`SELECT (extract(epoch FROM started_at) * 1000)::float8 AS start_ms,
          (extract(epoch FROM ended_at) * 1000)::float8 AS end_ms, cause
        FROM status_incidents WHERE ended_at > ${at(since)}
        ORDER BY started_at DESC`,
  );
  return rows.map((row) => ({
    start: new Date(row.start_ms),
    end: new Date(row.end_ms),
    cause: row.cause,
  }));
}

/** Saves the latest check of each part, keeping `since` while a part's state stays the same. */
export async function saveChecks(
  db: Database,
  checks: readonly PartCheck[],
  checkedAt: Date,
): Promise<void> {
  if (checks.length === 0) return;
  const values = sql.join(
    checks.map(
      (check) =>
        sql`(${check.part}, ${check.state}, ${check.message}, ${JSON.stringify(check.facts)}::jsonb,
          ${at(checkedAt)}, ${at(checkedAt)})`,
    ),
    sql`, `,
  );
  await db.execute(
    sql`INSERT INTO status_checks AS c (part, state, message, facts, checked_at, since)
        VALUES ${values}
        ON CONFLICT (part) DO UPDATE SET
          state = EXCLUDED.state,
          message = EXCLUDED.message,
          facts = EXCLUDED.facts,
          checked_at = EXCLUDED.checked_at,
          since = CASE WHEN c.state = EXCLUDED.state THEN c.since ELSE EXCLUDED.since END`,
  );
}

export async function listChecks(db: Database): Promise<SavedCheck[]> {
  const rows = await select<{
    part: Part;
    state: PartState;
    message: string | null;
    facts: Record<string, unknown> | null;
    checked_ms: number;
    since_ms: number;
  }>(
    db,
    sql`SELECT part, state, message, facts,
          (extract(epoch FROM checked_at) * 1000)::float8 AS checked_ms,
          (extract(epoch FROM since) * 1000)::float8 AS since_ms
        FROM status_checks`,
  );
  return rows.map((row) => ({
    part: row.part,
    state: row.state,
    message: row.message,
    facts: row.facts ?? {},
    checkedAt: new Date(row.checked_ms),
    since: new Date(row.since_ms),
  }));
}

/** Whole minutes between two instants, rounded down. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / MINUTE_MS);
}
