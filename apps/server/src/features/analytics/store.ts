// The Analytics tables (migration 202610270430_analytics_activity.sql). Times go in as ISO 8601
// strings, and counts come back as whole numbers.
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { countOnceWindow, type ActivityKind } from './domain/activity';
import { deleteBefore, type DaySpan } from './domain/range';

type Database = Db | Tx;

const DAY_MS = 86_400_000;
/** How many top pages and top editors Overview shows. */
export const TOP_COUNT = 10;

async function select<Row>(db: Database, query: SQL): Promise<Row[]> {
  const result = await db.execute(query);
  return result.rows as unknown as Row[];
}

const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

export interface Activity {
  workspaceId: string;
  userId: string;
  pageId: string;
  kind: ActivityKind;
  at: Date;
}

/**
 * Saves an activity, unless the same person already had a view or edit of the same page counted
 * within its count-once time (AN-01, AN-02). Returns whether it counted. The person's row for the
 * page is locked while saving, so two at the same moment (two tabs) count once. Record activity
 * in time order, as it happens: a view or edit from before the last counted one doesn't count.
 */
export async function recordActivity(db: Database, activity: Activity): Promise<boolean> {
  const { workspaceId, userId, pageId, kind } = activity;
  const values = sql`${workspaceId}::uuid, ${userId}::uuid, ${pageId}::uuid, ${kind}::text,
    ${at(activity.at)}`;
  const window = countOnceWindow(kind);
  if (window === 0) {
    await db.execute(
      sql`INSERT INTO analytics_activity (workspace_id, user_id, page_id, kind, at)
          VALUES (${values})`,
    );
    return true;
  }
  const saved = await select<{ id: string }>(
    db,
    sql`WITH counted AS (
          INSERT INTO analytics_last_counted AS c (user_id, page_id, kind, at)
          VALUES (${userId}::uuid, ${pageId}::uuid, ${kind}, ${at(activity.at)})
          ON CONFLICT (user_id, page_id, kind) DO UPDATE SET at = EXCLUDED.at
            WHERE c.at <= ${at(new Date(activity.at.getTime() - window))}
          RETURNING 1
        )
        INSERT INTO analytics_activity (workspace_id, user_id, page_id, kind, at)
        SELECT ${values} FROM counted
        RETURNING id`,
  );
  return saved.length > 0;
}

export type PageState = 'live' | 'trash' | 'deleted';

export interface PageInfo {
  pageId: string;
  workspaceId: string;
  title: string;
  spaceId: string | null;
  /** In use, in the Trash, or deleted for good. */
  state: PageState;
}

/** Keeps a page's title, space and state, so its numbers still show once it's deleted. */
export async function savePage(db: Database, page: PageInfo): Promise<void> {
  await db.execute(
    sql`INSERT INTO analytics_pages (page_id, workspace_id, title, space_id, state)
        VALUES (${page.pageId}::uuid, ${page.workspaceId}::uuid, ${page.title},
          ${page.spaceId}::uuid, ${page.state})
        ON CONFLICT (page_id) DO UPDATE SET title = EXCLUDED.title, space_id = EXCLUDED.space_id,
          state = EXCLUDED.state, updated_at = now()`,
  );
}

export interface OverviewFilter {
  workspaceId: string;
  /** The days to show, in order, as from daySpans. */
  days: readonly DaySpan[];
  /** Only this person's activity. */
  userId?: string;
  /** Only pages in this space. */
  spaceId?: string;
}

export interface DayNumbers {
  day: string;
  /** People with at least one view or edit that day. */
  activePeople: number;
  views: number;
  edits: number;
  created: number;
}

export interface TopPage {
  pageId: string;
  /** '' for an untitled page, or one Analytics never saw the title of. */
  title: string;
  state: PageState | null;
  views: number;
  /** How many people viewed it. */
  viewers: number;
}

export interface TopEditor {
  userId: string;
  name: string;
  edits: number;
}

export interface Overview {
  /** Active people in the whole range, and the range's views, edits and pages created. */
  totals: Omit<DayNumbers, 'day'>;
  days: DayNumbers[];
  /** The pages with the most views, then by title. */
  topPages: TopPage[];
  /** The people with the most edits, then by name. People whose account is gone aren't listed. */
  topEditors: TopEditor[];
}

/** Overview's numbers (Analytics spec, section 2; AN-04). Each day is the viewer's day. */
export async function getOverview(db: Database, filter: OverviewFilter): Promise<Overview> {
  const first = filter.days[0];
  const last = filter.days.at(-1);
  if (!first || !last) throw new RangeError('Overview needs at least one day.');
  const conditions = [sql`a.workspace_id = ${filter.workspaceId}::uuid`];
  if (filter.userId) conditions.push(sql`a.user_id = ${filter.userId}::uuid`);
  if (filter.spaceId) {
    conditions.push(
      sql`a.page_id IN (
            SELECT page_id FROM analytics_pages WHERE space_id = ${filter.spaceId}::uuid)`,
    );
  }
  const matches = sql.join(conditions, sql` AND `);
  const inRange = sql`${matches} AND a.at >= ${at(first.start)} AND a.at < ${at(last.end)}`;
  const spans = JSON.stringify(
    filter.days.map(({ day, start, end }) => ({ day, start_at: start, end_at: end })),
  );

  const days = await select<{
    day: string;
    active_people: number;
    views: number;
    edits: number;
    created: number;
  }>(
    db,
    sql`SELECT d.day,
          count(DISTINCT a.user_id) FILTER (WHERE a.kind IN ('view', 'edit'))::int AS active_people,
          count(*) FILTER (WHERE a.kind = 'view')::int AS views,
          count(*) FILTER (WHERE a.kind = 'edit')::int AS edits,
          count(*) FILTER (WHERE a.kind = 'create')::int AS created
        FROM jsonb_to_recordset(${spans}::jsonb)
          AS d (day text, start_at timestamptz, end_at timestamptz)
        LEFT JOIN analytics_activity a ON ${matches} AND a.at >= d.start_at AND a.at < d.end_at
        GROUP BY d.day
        ORDER BY d.day`,
  );
  const [active] = await select<{ active_people: number }>(
    db,
    sql`SELECT count(DISTINCT a.user_id)::int AS active_people
        FROM analytics_activity a
        WHERE ${inRange} AND a.kind IN ('view', 'edit')`,
  );
  const topPages = await select<TopPage>(
    db,
    sql`SELECT a.page_id::text AS "pageId", coalesce(p.title, '') AS title, p.state,
          count(*)::int AS views, count(DISTINCT a.user_id)::int AS viewers
        FROM analytics_activity a
        LEFT JOIN analytics_pages p ON p.page_id = a.page_id
        WHERE ${inRange} AND a.kind = 'view'
        GROUP BY a.page_id, p.title, p.state
        ORDER BY views DESC, lower(coalesce(p.title, '')), a.page_id
        LIMIT ${TOP_COUNT}`,
  );
  const topEditors = await select<TopEditor>(
    db,
    sql`SELECT u.id::text AS "userId", u.name, count(*)::int AS edits
        FROM analytics_activity a
        JOIN users u ON u.id = a.user_id
        WHERE ${inRange} AND a.kind = 'edit'
        GROUP BY u.id, u.name
        ORDER BY edits DESC, lower(u.name), u.id
        LIMIT ${TOP_COUNT}`,
  );

  const sum = (key: 'views' | 'edits' | 'created') => days.reduce((n, day) => n + day[key], 0);
  return {
    totals: {
      activePeople: active?.active_people ?? 0,
      views: sum('views'),
      edits: sum('edits'),
      created: sum('created'),
    },
    days: days.map(({ active_people, ...day }) => ({ ...day, activePeople: active_people })),
    topPages,
    topEditors,
  };
}

/**
 * The nightly clean-up (AN-07). Deletes activity from before deleteBefore(now), a batch at a
 * time; count-once times that ended over a day ago; and pages deleted for good with no activity
 * left. Returns how many activities it deleted.
 */
export async function cleanUp(db: Database, now: Date, batchSize = 5000): Promise<number> {
  const before = at(deleteBefore(now));
  let deleted = 0;
  for (;;) {
    const [batch] = await select<{ count: number }>(
      db,
      sql`WITH gone AS (
            DELETE FROM analytics_activity
            WHERE id IN (SELECT id FROM analytics_activity WHERE at < ${before} LIMIT ${batchSize})
            RETURNING 1
          )
          SELECT count(*)::int AS count FROM gone`,
    );
    const count = batch?.count ?? 0;
    deleted += count;
    if (count < batchSize) break;
  }
  await db.execute(
    sql`DELETE FROM analytics_last_counted WHERE at < ${at(new Date(now.getTime() - DAY_MS))}`,
  );
  await db.execute(
    sql`DELETE FROM analytics_pages p
        WHERE p.state = 'deleted'
          AND NOT EXISTS (SELECT 1 FROM analytics_activity a WHERE a.page_id = p.page_id)`,
  );
  return deleted;
}
