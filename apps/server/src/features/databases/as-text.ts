// Formula and rollup values as one person sees them, for a type change to Text (Databases spec
// 3.4: the values are kept as shown). W2-1's conversion context takes them for planConversion.
// They're worked out like a view query's: that person's property access here and in related
// databases, related rows they can open (read through a row cache), and the request's formula
// limits. Every row gets its value, also rows they can't open, from what they could see in it.
import type { EvalContext, Row, Viewer } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { withoutHidden } from '@carehub/databases/engine';
import { makeComputer, requestBudget } from './computed';
import { loadPeople, personIdsIn } from './people';
import type { DatabaseRecord } from './record';
import { accessLevels, loadRowCache, loadSchemas } from './row-cache';
import { loadPropertyViewer, type Executor } from './store';
import { viewContext } from './view-context';

export interface AsTextInput {
  record: DatabaseRecord;
  /** Who changes the type. */
  userId: string;
  viewer: Viewer;
  /** Every row of the database, as the type change reads them. */
  rows: readonly Row[];
  /** Formula time (tests pass a fake clock). */
  clock?: () => number;
  budgetMs?: number;
}

/** What planConversion's context needs to turn a Formula or Rollup property into Text. */
export interface ValuesAsShown extends Required<
  Pick<EvalContext, 'computed' | 'rowTitle' | 'isRemovedUser'>
> {
  /** Some value said "⚠ Too slow". */
  readonly timedOut: boolean;
}

/** The database's formula and rollup values (and related titles) as `userId` sees them. */
export async function computedAsText(db: Executor, input: AsTextInput): Promise<ValuesAsShown> {
  const { record, userId, rows } = input;
  const who = await loadPropertyViewer(db, userId, record.workspaceId);
  const schemas = await loadSchemas(db, record, who);
  const levels = await accessLevels(
    db,
    userId,
    rows.map((r) => r.id),
  );
  const cache = await loadRowCache(db, { userId, schemas, rows, levels, everyRow: true });
  const { home } = schemas;
  const people = await loadPeople(db, record.workspaceId, [
    ...personIdsIn(cache.homeRows, home.shown),
    ...personIdsIn(
      [...cache.rows.values()].map((c) => c.row),
      [...schemas.byId.values()].flatMap((s) => s.shown),
    ),
  ]);
  const viewer: Viewer = { ...input.viewer, groupIds: who.groupIds ?? [] };
  if (who.roleId) viewer.roleId = who.roleId;
  const budget = requestBudget(input.clock, input.budgetMs);
  const computer = makeComputer({ schemas, cache, viewer, people, budget });
  const stripping = home.shown.length < home.properties.length;
  const seen = (row: Row) => withoutHidden(row, home.visible, stripping);
  const cleaned = new Map(cache.homeRows.map((r) => [r.id, seen(r)]));
  const open = new Map([...cleaned].filter(([id]) => atLeast(levels.get(id), 'view')));
  const context = viewContext({
    properties: home.shown,
    rowIds: new Set(cleaned.keys()),
    open,
    viewer,
    people,
    computer,
    budget,
  });
  const { ctx } = context;
  return {
    computed: (row, propertyId) => ctx.computed(cleaned.get(row.id) ?? seen(row), propertyId),
    rowTitle: (id) => ctx.rowTitle?.(id),
    isRemovedUser: (id) => people.removed(id),
    get timedOut() {
      return context.timedOut;
    },
  };
}
