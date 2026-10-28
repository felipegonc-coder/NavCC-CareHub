// A context like the one the view engine makes for itself (W2-3), for work done on the same terms
// outside runViewQuery: chart data, CSV exports, and the values a type change to Text keeps. It has
// the properties the viewer sees and the rows they can open, and formula and rollup results come
// from the request's computer, remembered per row, guarded against loops and stopped once the
// request's time is up. countedRows gives the rows a view counts, with such a context.
import type { ComputedValue, Id, Property, Row, Viewer } from '@carehub/databases';
import {
  QUERY_TOO_SLOW,
  applyOverride,
  runViewQuery,
  type ComputeContext,
  type ViewQueryBlocked,
} from '@carehub/databases/engine';
import { guardLoops } from '@carehub/databases/rollup';
import type { Computer, RequestBudget } from './computed';
import type { PeopleBook } from './people';
import { arrangeFor, type PreparedQuery } from './query';
import type { DatabaseRecord } from './record';

const EMPTY: ComputedValue = { kind: 'empty' };

export interface ViewContextInput {
  /** The database's properties the viewer sees. */
  properties: readonly Property[];
  /** Every row of the database, open or not (a row they can't open has no title here). */
  rowIds: ReadonlySet<Id>;
  /** The rows the viewer can open, with hidden values left out. */
  open: ReadonlyMap<Id, Row>;
  viewer: Viewer;
  people: PeopleBook;
  computer: Computer;
  budget: RequestBudget;
}

export interface ViewContext {
  ctx: ComputeContext;
  /** Some result said "⚠ Too slow". */
  readonly timedOut: boolean;
}

/** The context, and whether any result in it ran out of time. */
export function viewContext(input: ViewContextInput): ViewContext {
  const { open, computer, budget } = input;
  const shown = new Map(input.properties.map((p) => [p.id, p]));
  let slow = false;
  const work = (row: Row, propertyId: Id): ComputedValue => {
    const type = shown.get(propertyId)?.config.type;
    if (type !== 'formula' && type !== 'rollup') return EMPTY;
    if (budget.clock() > budget.deadline) {
      slow = true;
      return { kind: 'error', message: QUERY_TOO_SLOW };
    }
    return computer.computed(row, propertyId, ctx);
  };
  const guarded = guardLoops(work);
  const memo = new Map<Id, Map<Id, ComputedValue>>();
  const ctx: ComputeContext = {
    properties: input.properties,
    viewer: input.viewer,
    userName: (id) => input.people.name(id),
    isRemovedUser: (id) => input.people.removed(id),
    rowTitle: (id) => (input.rowIds.has(id) ? open.get(id)?.title : computer.rowTitle(id)),
    openRow: (id) => open.get(id),
    computed(row, propertyId) {
      let byRow = memo.get(row.id);
      if (!byRow) memo.set(row.id, (byRow = new Map()));
      let value = byRow.get(propertyId);
      if (!value) {
        value = guarded(row, propertyId);
        byRow.set(propertyId, value);
      }
      return value;
    },
    budget,
  };
  return {
    ctx,
    get timedOut() {
      return slow || computer.timedOut;
    },
  };
}

/** The rows a view counts, and a context to read their values the way the view shows them. */
export interface CountedRows {
  /** In view order, once each, with hidden values left out. */
  rows: Row[];
  context: ViewContext;
  /** The engine ran out of formula time while it filtered or sorted. */
  timedOut: boolean;
}

/**
 * The rows the prepared view counts (the ones its table totals), in view order. Its grouping is
 * ignored. The engine applies row access, the filter (with the override) and sub-items, and leaves
 * hidden values out; no page of rows is made.
 */
export function countedRows(
  record: DatabaseRecord,
  prepared: PreparedQuery,
): ViewQueryBlocked | CountedRows {
  const { input } = prepared;
  const view = { ...applyOverride(input.view, input.override), grouping: null, subGrouping: null };
  const nested = arrangeFor(record, view);
  let open: ReadonlyMap<Id, Row> = new Map();
  let rows: Row[] = [];
  const result = runViewQuery({
    ...input,
    view,
    override: null,
    arrange: (given, matches) => {
      open = new Map(given.map((r) => [r.id, r]));
      rows = nested
        ? nested(given, matches).flatMap((line) => {
            const row = line.context ? undefined : open.get(line.row.id);
            return row ? [row] : [];
          })
        : given.filter(matches);
      return [];
    },
  });
  if ('blocked' in result) return result;
  const context = viewContext({
    properties: prepared.shown,
    rowIds: new Set(input.rows.map((r) => r.id)),
    open,
    viewer: input.viewer,
    people: prepared.people,
    computer: prepared.computer,
    budget: prepared.budget,
  });
  return { rows, context, timedOut: result.timedOut };
}
