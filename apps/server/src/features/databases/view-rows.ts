// Server functions for other lanes (decision 0200, W2-3; api.ts re-exports them). listViewRows
// answers a saved view for one person the way POST /:id/query does, and exportViewCsv makes the
// CSV text of an export (Databases spec 3.8) that the export job saves. Both check that person's
// access to the database first: 404 when it's missing or in Trash, 403 below Can view.
import { defaultView, readValue, todayIn, type View } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { exportColumns, exportFileName, exportTable, writeCsv } from '@carehub/databases/csv';
import { VIEW_BLOCKED } from '@carehub/databases/engine';
import { formatValue } from '@carehub/databases/values';
import { sql } from 'drizzle-orm';
import { getPageAccess } from '../pages';
import { forbidden, invalidRequest, notFound } from './errors';
import { answerViewQuery, prepareQuery, type QueryUser, type ViewAnswer } from './query';
import { CURSOR_LENGTH } from './query-routes';
import { isUuid, type DatabaseRecord } from './record';
import { loadDatabase, type Executor } from './store';
import { countedRows } from './view-context';

export interface ViewRowsInput {
  userId: string;
  databaseId: string;
  viewId: string;
  /** The last answer's nextCursor, for the page after it. */
  cursor?: string | null;
}

export interface ExportInput {
  userId: string;
  databaseId: string;
  /** This view (its filter, sorts and visible properties), or null for Everything. */
  viewId: string | null;
  /** The current moment (tests pass a fixed one). */
  now?: Date;
  /** Formula time (tests pass a fake clock). */
  clock?: () => number;
  budgetMs?: number;
}

/** An export's file, for the job to save (db_exports). */
export interface CsvExport {
  /** "Jobs – Open – 2026-10-27.csv", dated with the exporter's today. */
  fileName: string;
  /** UTF-8 text with a byte order mark, commas, CRLF line endings and a header row. */
  csv: string;
  /** Rows written, not counting the header row. */
  rowCount: number;
  /** Some formula or rollup ran out of time and says "⚠ Too slow". */
  timedOut: boolean;
}

type UserRow = { time_zone: string; use_24h: boolean; week_start: number };

/** The database and the person, when they can open it (Can view). */
async function openDatabase(
  db: Executor,
  userId: string,
  databaseId: string,
): Promise<{ record: DatabaseRecord; user: QueryUser }> {
  const record = await loadDatabase(db, databaseId);
  if (!record || record.inTrash) throw notFound();
  if (!isUuid(userId) || !atLeast(await getPageAccess(db, userId, record.id), 'view')) {
    throw forbidden();
  }
  const { rows } = await db.execute<UserRow>(sql`
    SELECT time_zone, use_24h, week_start FROM users WHERE id = ${userId}`);
  const row = rows[0];
  if (!row) throw forbidden();
  return {
    record,
    user: { id: userId, timeZone: row.time_zone, use24h: row.use_24h, weekStart: row.week_start },
  };
}

/** One page of a saved view for one person: rows they can open, without hidden properties. */
export async function listViewRows(db: Executor, input: ViewRowsInput): Promise<ViewAnswer> {
  const { record, user } = await openDatabase(db, input.userId, input.databaseId);
  const view = record.views.find((v) => v.id === input.viewId);
  if (!view) throw notFound();
  const cursor = input.cursor ?? null;
  if (cursor !== null && cursor.length > CURSOR_LENGTH) throw invalidRequest();
  return answerViewQuery(db, { record, view, user, cursor });
}

/**
 * The CSV of This view (its filter and sorts, grouping ignored, its visible properties in view
 * order) or of Everything (every row and property), as one person sees it: rows they can open,
 * without properties they can't see, values written as shown in their time zone. 403 with
 * VIEW_BLOCKED for a view that uses a property they can't see.
 */
export async function exportViewCsv(db: Executor, input: ExportInput): Promise<CsvExport> {
  const { record, user } = await openDatabase(db, input.userId, input.databaseId);
  const saved = input.viewId === null ? null : record.views.find((v) => v.id === input.viewId);
  if (saved === undefined) throw notFound();
  // Everything: a table of every property, every row in the database's order.
  const view: View = saved ?? { ...defaultView('table', record.properties), subItems: 'flattened' };
  const { now, clock, budgetMs } = input;
  const prepared = await prepareQuery(db, { record, view, user, now, clock, budgetMs });
  if ('blocked' in prepared) throw forbidden(VIEW_BLOCKED);
  const counted = countedRows(record, prepared);
  if ('blocked' in counted) throw forbidden(VIEW_BLOCKED);
  const { ctx } = counted.context;
  const table = exportTable(exportColumns(prepared.shown, saved), counted.rows, (row, prop) =>
    formatValue(prop, readValue(row, prop, ctx), ctx, { forExport: true }),
  );
  return {
    fileName: exportFileName(record, saved, todayIn(prepared.input.viewer)),
    csv: writeCsv(table),
    rowCount: counted.rows.length,
    timedOut: counted.timedOut || counted.context.timedOut,
  };
}
