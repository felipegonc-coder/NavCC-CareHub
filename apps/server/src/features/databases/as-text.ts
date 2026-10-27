// Formula and rollup values as one person sees them, for a type change (Databases spec 3.4: the
// values are kept as shown). They're worked out like a view query's: that person's property access
// here and in related databases, the related rows they can open and the request's formula limits.
// Rows they can't open get no value. A Formula or Rollup that reads a property with a see list
// can't change type: its values would then show to everyone.
import type { ComputedValue, EvalContext, Id, Row, Viewer } from '@carehub/databases';
import { atLeast } from '@carehub/databases/access';
import { withoutHidden } from '@carehub/databases/engine';
import { makeComputer, requestBudget } from './computed';
import { invalid } from './errors';
import { loadPeople, personIdsIn } from './people';
import type { DatabaseRecord } from './record';
import { accessLevels, loadRowCache, loadSchemas } from './row-cache';
import { loadPropertyViewer, type Executor } from './store';
import { viewContext } from './view-context';
import type { Schemas } from './view-access';

/** The refusal for a Formula or Rollup that reads a property with a see list. */
export const READS_LIMITED_MESSAGE =
  "This formula reads a property that not everyone can see, so it can't become text.";

const EMPTY: ComputedValue = { kind: 'empty' };

export interface AsTextInput {
  record: DatabaseRecord;
  /** The Formula or Rollup property whose type changes. */
  propertyId: Id;
  /** Who changes the type. */
  userId: string;
  viewer: Viewer;
  /** Every row of the database, as the type change reads them. */
  rows: readonly Row[];
  /** Formula time (tests pass a fake clock). */
  clock?: () => number;
  budgetMs?: number;
}

/** What planConversion's context needs to turn a Formula or Rollup property into another type. */
export interface ValuesAsShown extends Required<
  Pick<EvalContext, 'computed' | 'rowTitle' | 'isRemovedUser'>
> {
  /** Some value said "⚠ Too slow". */
  readonly timedOut: boolean;
}

/** Whether a property reads one with a see list, directly or through formulas and rollups. */
export function readsLimitedProperty(schemas: Schemas, propertyId: Id): boolean {
  const seen = new Set<Id>([propertyId]);
  const stack = [...schemas.dependsOn(propertyId)];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const read = schemas.property(id)?.property;
    if (!read) continue;
    if (read.config.type !== 'title' && (read.access?.see ?? null) !== null) return true;
    stack.push(...schemas.dependsOn(id));
  }
  return false;
}

/**
 * The database's formula and rollup values (and related titles) as `userId` sees them. 400 with
 * READS_LIMITED_MESSAGE when `propertyId` reads a property with a see list.
 */
export async function computedAsText(db: Executor, input: AsTextInput): Promise<ValuesAsShown> {
  const { record, userId, rows } = input;
  const who = await loadPropertyViewer(db, userId, record.workspaceId);
  const schemas = await loadSchemas(db, record, who);
  if (readsLimitedProperty(schemas, input.propertyId)) throw invalid(READS_LIMITED_MESSAGE);
  const ids = rows.map((r) => r.id);
  const levels = await accessLevels(db, userId, ids);
  const cache = await loadRowCache(db, { userId, schemas, rows, levels });
  const { home } = schemas;
  const stripping = home.shown.length < home.properties.length;
  const open = new Map(
    cache.homeRows
      .filter((r) => atLeast(levels.get(r.id), 'view'))
      .map((r) => [r.id, withoutHidden(r, home.visible, stripping)]),
  );
  const people = await loadPeople(db, record.workspaceId, [
    ...personIdsIn([...open.values()], home.shown),
    ...personIdsIn(
      [...cache.rows.values()].map((c) => c.row),
      [...schemas.byId.values()].flatMap((s) => s.shown),
    ),
  ]);
  const viewer: Viewer = { ...input.viewer, groupIds: who.groupIds ?? [] };
  if (who.roleId) viewer.roleId = who.roleId;
  const budget = requestBudget(input.clock, input.budgetMs);
  const computer = makeComputer({ schemas, cache, viewer, people, budget });
  const context = viewContext({
    properties: home.shown,
    rowIds: new Set(ids),
    open,
    viewer,
    people,
    computer,
    budget,
  });
  const { ctx } = context;
  return {
    computed: (row, propertyId) => {
      const mine = open.get(row.id);
      return mine ? ctx.computed(mine, propertyId) : EMPTY;
    },
    rowTitle: (id) => ctx.rowTitle?.(id),
    isRemovedUser: (id) => people.removed(id),
    get timedOut() {
      return context.timedOut;
    },
  };
}
