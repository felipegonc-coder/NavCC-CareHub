// A context like the one the view engine makes for itself (W2-3), for work done on the same terms
// outside runViewQuery: chart data, and the values a type change to Text keeps. It has the
// properties the viewer sees and the rows they can open, and formula and rollup results come from
// the request's computer, remembered per row, guarded against loops and stopped once the request's
// time is up.
import type { ComputedValue, Id, Property, Row, Viewer } from '@carehub/databases';
import { QUERY_TOO_SLOW, type ComputeContext } from '@carehub/databases/engine';
import { guardLoops } from '@carehub/databases/rollup';
import type { Computer, RequestBudget } from './computed';
import type { PeopleBook } from './people';

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
