/**
 * The context one query runs in (W1c-1): the visible properties, the rows the viewer can open, and
 * formula and rollup results worked out once per row and property, guarded against loops and
 * stopped once the time budget runs out.
 */
import { guardLoops } from '../rollup';
import type { ComputedValue, Id, Property, Row } from '../types';
import { QUERY_TOO_SLOW, type ComputeContext, type ViewQueryInput } from './shapes';

const EMPTY: ComputedValue = { kind: 'empty' };

/** The context the query runs in: visible properties, open rows, remembered and guarded results. */
export function makeContext(
  input: ViewQueryInput,
  properties: Property[],
  open: ReadonlyMap<Id, Row>,
  state: { timedOut: boolean },
): ComputeContext {
  const own = new Set(input.rows.map((r) => r.id));
  const shown = new Map(properties.map((p) => [p.id, p]));
  const { budget } = input;
  const work = (row: Row, propertyId: Id): ComputedValue => {
    const type = shown.get(propertyId)?.config.type;
    if ((type !== 'formula' && type !== 'rollup') || !input.computed) return EMPTY;
    if (budget && budget.clock() > budget.deadline) {
      state.timedOut = true;
      return { kind: 'error', message: QUERY_TOO_SLOW };
    }
    return input.computed(row, propertyId, ctx);
  };
  const guarded = guardLoops(work);
  const memo = new Map<Id, Map<Id, ComputedValue>>();
  const ctx: ComputeContext = {
    properties,
    viewer: input.viewer,
    userName: (id) => input.userName(id),
    rowTitle: (id) => (own.has(id) ? open.get(id)?.title : input.rowTitle?.(id)),
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
  };
  if (input.isRemovedUser) ctx.isRemovedUser = (id) => input.isRemovedUser?.(id) === true;
  if (budget) ctx.budget = budget;
  return ctx;
}
