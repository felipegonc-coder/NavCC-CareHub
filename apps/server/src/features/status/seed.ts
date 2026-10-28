// Fictional status history for development and browser tests: 31 days of heartbeats with three
// incidents, 43 missing minutes in all, so /status shows coloured day bars and 99.90% (ST-10).
import { sql } from 'drizzle-orm';
import type { Db } from '../../db';
import type { SeedContext } from '../../seed';
import type { IncidentCause } from './domain/incidents';
import { DAY_MINUTES, MINUTE_MS, epochMinute } from './domain/time';
import { readStatusSettings } from './settings';

/** The seeded incidents: how many days ago they started, their length in minutes, their cause. */
export const SEEDED_INCIDENTS: readonly {
  daysAgo: number;
  minutes: number;
  cause: IncidentCause;
}[] = [
  { daysAgo: 8, minutes: 5, cause: 'update' },
  { daysAgo: 15, minutes: 3, cause: 'restart' },
  { daysAgo: 22, minutes: 35, cause: 'unknown' },
];

const SEEDED_DAYS = 31;

/** Safe to run twice: it does nothing once heartbeats older than a day exist. */
export async function seed(ctx: Pick<SeedContext, 'db' | 'log'>, now = new Date()): Promise<void> {
  const db = ctx.db as Db;
  const last = epochMinute(now.getTime());
  const first = last - SEEDED_DAYS * DAY_MINUTES;
  const seeded = await db.execute(
    sql`SELECT 1 FROM status_heartbeats WHERE minute < to_timestamp(${(last - DAY_MINUTES) * 60})
        LIMIT 1`,
  );
  if (seeded.rows.length > 0) return;

  const gaps = SEEDED_INCIDENTS.map(({ daysAgo, minutes, cause }) => {
    // At 14:20 UTC, during the working day in America/Denver.
    const start = last - daysAgo * DAY_MINUTES - (last % DAY_MINUTES) + 14 * 60 + 20;
    return { start, end: start + minutes, cause };
  });
  const outside = sql.join(
    gaps.map((gap) => sql`NOT (m >= ${gap.start} AND m < ${gap.end})`),
    sql` AND `,
  );
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`INSERT INTO status_heartbeats (minute)
          SELECT to_timestamp(m::float8 * 60) FROM generate_series(${first}::int, ${last}::int) AS m
          WHERE ${outside}
          ON CONFLICT DO NOTHING`,
    );
    for (const gap of gaps) {
      await tx.execute(
        sql`INSERT INTO status_incidents (started_at, ended_at, cause)
            VALUES (to_timestamp(${gap.start * 60}), to_timestamp(${gap.end * 60}), ${gap.cause})
            ON CONFLICT (started_at) DO NOTHING`,
      );
    }
    // Installed when the history starts, updated at the seeded update, stopped in order.
    const toTime = (minute: number) =>
      sql`${new Date(minute * MINUTE_MS).toISOString()}::timestamptz`;
    const updatedAt = gaps[0] ? gaps[0].end : first;
    await tx.execute(
      sql`INSERT INTO status_server
            (id, installed_at, version, version_since, started_at, stopped_at)
          VALUES (1, ${toTime(first)}, ${readStatusSettings({ log: ctx.log }).CAREHUB_VERSION},
            ${toTime(updatedAt)}, ${toTime(updatedAt)}, ${toTime(last)})
          ON CONFLICT (id) DO UPDATE SET
            installed_at = LEAST(status_server.installed_at, EXCLUDED.installed_at)`,
    );
  });
  ctx.log.info('Seeded 31 days of status history with 3 incidents (43 minutes down)');
}
