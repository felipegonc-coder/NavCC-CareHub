// POST /:id/query for one viewer (decision 0200, W2-3): the view engine over the database's rows
// with property access (here and in related databases), row access for every row, "Changed for
// you only", search and paging, formulas and rollups worked out on the server, and the people the
// rows show. A view that uses a property the viewer can't see answers only { blocked }.
import type { Id, View, ViewOverride, Viewer, WeekDay } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import {
  VIEW_BLOCKED,
  applyOverride,
  runViewQuery,
  usesHiddenProperty,
  type ArrangedLine,
  type ViewQueryBlocked,
  type ViewQueryData,
  type ViewQueryInput,
} from '@carehub/databases/engine';
import { subItemLines, subItemTree, type SubItemMode } from '@carehub/databases/hierarchy';
import { makeComputer, requestBudget } from './computed';
import { loadPeople, peopleShown, personIdsIn, type PersonShown } from './people';
import type { DatabaseRecord } from './record';
import { accessLevels, loadRowCache, loadSchemas } from './row-cache';
import { loadPropertyViewer, loadRows, type Executor } from './store';

/** The signed-in person, as request.user has them. */
export interface QueryUser {
  id: string;
  timeZone: string;
  use24h: boolean;
  weekStart: number;
}

export interface ViewQuery {
  record: DatabaseRecord;
  view: View;
  user: QueryUser;
  override?: ViewOverride | null;
  search?: string | null;
  cursor?: string | null;
  /** The current moment (tests pass a fixed one). */
  now?: Date;
  /** Formula time, from when the engine starts (tests pass a fake clock). */
  clock?: () => number;
  budgetMs?: number;
}

/** The answer: the engine's, with `people` ({ name, avatarUrl } for everyone the rows show). */
export type ViewAnswer = ViewQueryBlocked | (ViewQueryData & { people: Record<Id, PersonShown> });

/** Layouts that draw sub-items under their parents; the others show them on their own. */
const NESTING_LAYOUTS: ReadonlySet<View['layout']> = new Set(['table', 'list', 'timeline']);

const weekDay = (n: number): WeekDay =>
  (Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0) as WeekDay;

/** Sub-items as the view shows them: every line, expanded (screens collapse them). */
function arrangeFor(record: DatabaseRecord, view: View): ViewQueryInput['arrange'] | undefined {
  const settings = record.subItems;
  if (!settings) return undefined;
  const asked: SubItemMode = view.subItems ?? 'nested';
  const mode: SubItemMode = NESTING_LAYOUTS.has(view.layout)
    ? asked
    : asked === 'parents_only'
      ? 'parents_only'
      : 'flattened';
  if (mode === 'flattened') return undefined;
  return (rows, matches): ArrangedLine[] =>
    subItemLines(
      subItemTree(rows, settings, { mode, matches, filterSubItems: view.filterSubItems }),
      () => true,
    ).map(({ row, depth, parentId, childCount, context }) => ({
      row,
      depth,
      parentId,
      childCount,
      context,
    }));
}

/** Answers a view of the database for one person. */
export async function answerViewQuery(db: Executor, query: ViewQuery): Promise<ViewAnswer> {
  const { record, view, user } = query;
  const who = await loadPropertyViewer(db, user.id, record.workspaceId);
  const schemas = await loadSchemas(db, record, who);
  // Checked before any row is read; the engine checks it again.
  if (
    usesHiddenProperty(applyOverride(view, query.override), record.properties, schemas.home.visible)
  ) {
    return { blocked: VIEW_BLOCKED };
  }
  const rows = await loadRows(db, record.id);
  const levels = await accessLevels(
    db,
    user.id,
    rows.map((r) => r.id),
  );
  const cache = await loadRowCache(db, { userId: user.id, schemas, rows, levels });
  const open = cache.homeRows.filter((r) => atLeast(levels.get(r.id), 'view'));
  const people = await loadPeople(db, record.workspaceId, [
    ...personIdsIn(open, schemas.home.shown),
    ...personIdsIn(
      [...cache.rows.values()].map((c) => c.row),
      [...schemas.byId.values()].flatMap((s) => s.shown),
    ),
  ]);

  const viewer: Viewer = {
    userId: user.id,
    timeZone: user.timeZone,
    weekStart: weekDay(user.weekStart),
    hour12: !user.use24h,
    now: query.now ?? new Date(),
    groupIds: who.groupIds ?? [],
  };
  if (who.roleId) viewer.roleId = who.roleId;
  const budget = requestBudget(query.clock, query.budgetMs);
  const computer = makeComputer({ schemas, cache, viewer, people, budget });
  const input: ViewQueryInput = {
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
    view,
    override: query.override ?? null,
    search: query.search ?? null,
    cursor: query.cursor ?? null,
  };
  const arrange = arrangeFor(record, view);
  if (arrange) input.arrange = arrange;
  const result = runViewQuery(input);
  if ('blocked' in result) return result;
  const shownProps = record.properties.filter((p) => schemas.home.visible.has(p.id));
  return {
    ...result,
    timedOut: result.timedOut || computer.timedOut,
    people: peopleShown(result, shownProps, people),
  };
}
