// The rows of a CSV export as one person sees them (decision 0200; spec 3.8). This stands in for
// W2-3's exportViewCsv until that lands, and shows exactly what POST /:id/query shows the person:
// only rows they can open, no column for a property they can't see (property access lists, and
// formulas and rollups that read one anywhere in their chain), and people by the names they may
// see. It loads once with the query's own pieces (as query.ts does) and runs the view engine page
// after page over that load, with the view's filter and sorts. Grouping and sub-items are left
// out: every matching row comes once, in view order.
import {
  DEFAULT_TIME_ZONE,
  defaultView,
  isValidTimeZone,
  readValue,
  todayIn,
  type CalendarDate,
  type ComputedValue,
  type EvalContext,
  type Id,
  type Property,
  type Row,
  type View,
  type Viewer,
  type WeekDay,
} from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { exportColumns } from '@carehub/databases/csv';
import {
  HIDDEN_ROW_ID,
  VIEW_BLOCKED,
  runViewQuery,
  usesHiddenProperty,
  type QueryRow,
  type ViewQueryInput,
} from '@carehub/databases/engine';
import { formatValue } from '@carehub/databases/values';
import { sql } from 'drizzle-orm';
import { makeComputer, requestBudget } from './computed';
import { loadPeople, personIdsIn } from './people';
import { isUuid, type DatabaseRecord } from './record';
import { accessLevels, loadRowCache, loadSchemas } from './row-cache';
import { loadPropertyViewer, loadRows, type Executor } from './store';
import { linkIds } from './view-access';

/** Time for formulas and rollups over a whole export (a query has 1 s for one page). */
export const EXPORT_FORMULA_MS = 60_000;
/** Rows per engine page: the most one page holds. */
const PAGE_ROWS = 100;
const EMPTY: ComputedValue = { kind: 'empty' };

/** What a CSV export holds, for the package's exportTable. */
export interface ExportRows {
  /** Name first, then the view's visible properties in view order (Everything: every property). */
  columns: Property[];
  /** Every matching row the person can open, in view order. */
  rows: Row[];
  /** A cell as the person sees it, written for export (relative dates in full, plain names). */
  cellText(row: Row, property: Property): string;
  /** The person's today, for the file name. */
  today: CalendarDate;
}

export interface ExportRowsInput {
  record: DatabaseRecord;
  /** This view; null for Everything. */
  view: View | null;
  userId: string;
  /** The current moment (tests pass a fixed one). */
  now?: Date;
  /** Checked between pages (the job's timeout and cancel). */
  signal?: AbortSignal;
  /** After each page: rows so far, and how many match. */
  onPage?(done: number, total: number): void;
}

type Settings = { time_zone: string; use_24h: boolean; week_start: number };

const weekDay = (n: number): WeekDay =>
  (Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0) as WeekDay;

/** Everything: all rows (oldest first) and every property, without filter or sorts. */
const everything = (properties: readonly Property[]): View =>
  defaultView('table', properties, { name: 'Everything' });

/** The person's time zone, clock and week, as request.user has them for the query. */
async function viewerOf(
  db: Executor,
  userId: string,
  who: { groupIds?: readonly string[]; roleId?: string | null },
  now: Date,
): Promise<Viewer> {
  const { rows } = isUuid(userId)
    ? await db.execute<Settings>(sql`
        SELECT time_zone, use_24h, week_start FROM users WHERE id = ${userId}`)
    : { rows: [] as Settings[] };
  const settings = rows[0];
  const zone = settings?.time_zone;
  const viewer: Viewer = {
    userId,
    timeZone: zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
    weekStart: weekDay(Number(settings?.week_start ?? 0)),
    hour12: !(settings?.use_24h ?? false),
    now,
    groupIds: [...(who.groupIds ?? [])],
  };
  if (who.roleId) viewer.roleId = who.roleId;
  return viewer;
}

/** A row of the engine's answer as a package Row; links it left out count as hidden rows. */
function rowOf(line: QueryRow, relations: readonly Property[]): Row {
  const values = { ...line.values };
  for (const relation of relations) {
    const hidden = line.hiddenLinks[relation.id] ?? 0;
    if (hidden > 0) {
      values[relation.id] = [...linkIds(values[relation.id]), ...Array(hidden).fill(HIDDEN_ROW_ID)];
    }
  }
  return {
    id: line.id,
    title: line.title,
    values,
    createdAt: line.createdAt ?? '',
    createdBy: line.createdBy,
    editedAt: line.editedAt ?? '',
    editedBy: line.editedBy,
    uniqueNumber: line.uniqueNumber,
  };
}

/** Whether the view uses a property the person can't see (the query answers { blocked }). */
export async function exportBlocked(
  db: Executor,
  input: { record: DatabaseRecord; view: View; userId: string },
): Promise<boolean> {
  const who = await loadPropertyViewer(db, input.userId, input.record.workspaceId);
  const schemas = await loadSchemas(db, input.record, who);
  return usesHiddenProperty(input.view, input.record.properties, schemas.home.visible);
}

/** The export's columns and rows for one person, or { blocked } as the query would answer. */
export async function readExportRows(
  db: Executor,
  input: ExportRowsInput,
): Promise<ExportRows | { blocked: string }> {
  const { record, userId } = input;
  const who = await loadPropertyViewer(db, userId, record.workspaceId);
  const schemas = await loadSchemas(db, record, who);
  const saved = input.view ?? everything(record.properties);
  // The saved view decides, before any row is read, as in the query.
  if (usesHiddenProperty(saved, record.properties, schemas.home.visible)) {
    return { blocked: VIEW_BLOCKED };
  }
  const all = await loadRows(db, record.id);
  const levels = await accessLevels(
    db,
    userId,
    all.map((r) => r.id),
  );
  const cache = await loadRowCache(db, { userId, schemas, rows: all, levels });
  const open = cache.homeRows.filter((r) => atLeast(levels.get(r.id), 'view'));
  const people = await loadPeople(db, record.workspaceId, [
    ...personIdsIn(open, record.properties),
    ...personIdsIn(
      [...cache.rows.values()].map((c) => c.row),
      [...schemas.byId.values()].flatMap((s) => s.shown),
    ),
  ]);
  const viewer = await viewerOf(db, userId, who, input.now ?? new Date());
  const budget = requestBudget(undefined, EXPORT_FORMULA_MS);
  const computer = makeComputer({ schemas, cache, viewer, people, budget });
  const query: ViewQueryInput = {
    viewer,
    userName: (id) => people.name(id),
    isRemovedUser: (id) => people.removed(id),
    rowAccess: (row) => levels.get(row.id) ?? 'none',
    canSeeProperty: schemas.canSee,
    dependsOn: schemas.dependsOn,
    computed: computer.computed,
    rowTitle: computer.rowTitle,
    budget,
    properties: record.properties,
    rows: cache.homeRows,
    // One flat list: no groups, totals or colors, and the biggest pages.
    view: {
      ...saved,
      grouping: null,
      subGrouping: null,
      calculations: {},
      colorRules: [],
      loadLimit: PAGE_ROWS,
    },
  };

  const lines: QueryRow[] = [];
  const titles = new Map<Id, string>();
  let shown = new Set<Id>(schemas.home.visible);
  // Every page holds PAGE_ROWS rows, so this many pages always reach the end.
  let pagesLeft = Math.ceil(cache.homeRows.length / PAGE_ROWS) + 1;
  let cursor: string | null = null;
  do {
    input.signal?.throwIfAborted();
    if (pagesLeft-- === 0) throw new Error('The export went past its last page.');
    const answer = runViewQuery({ ...query, cursor });
    if ('blocked' in answer) return answer;
    lines.push(...answer.rows);
    for (const [id, title] of Object.entries(answer.rowTitles)) titles.set(id, title);
    shown = new Set(answer.propertyIds);
    input.onPage?.(lines.length, answer.count);
    cursor = answer.nextCursor;
    // Other requests get their turn between pages.
    if (cursor !== null) await new Promise((resolve) => setImmediate(resolve));
  } while (cursor !== null);

  const properties = record.properties.filter((p) => shown.has(p.id));
  const relations = properties.filter((p) => p.config.type === 'relation');
  const computedOf = new Map(lines.map((l) => [l.id, l.computed]));
  const ctx: EvalContext = {
    properties,
    viewer,
    userName: (id) => people.name(id),
    isRemovedUser: (id) => people.removed(id),
    rowTitle: (id) => titles.get(id),
    computed: (row, propertyId) => computedOf.get(row.id)?.[propertyId] ?? EMPTY,
  };
  return {
    columns: exportColumns(properties, input.view),
    rows: lines.map((line) => rowOf(line, relations)),
    cellText: (row, property) =>
      formatValue(property, readValue(row, property, ctx), ctx, { forExport: true }),
    today: todayIn(viewer),
  };
}
