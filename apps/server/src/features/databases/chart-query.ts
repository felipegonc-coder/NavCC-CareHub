// POST /:id/chart (decision 0200, W2-3): a Chart view's data for one person. The rows are the ones
// its table would count: the view engine applies row access, the filter (with "Changed for you
// only") and sub-items, and leaves hidden values out. Property access is the view query's: a chart
// that uses a property the viewer can't see answers only { blocked }.
import type { Id, Row } from '@carehub/databases';
import { chartData, type ChartData } from '@carehub/databases/chart';
import { runViewQuery, type ViewQueryBlocked } from '@carehub/databases/engine';
import { arrangeFor, prepareQuery, type ViewBase } from './query';
import type { Executor } from './store';
import { viewContext } from './view-context';

/** Chart data, and whether some formula or rollup ran out of time ("⚠ Too slow"). */
export type ChartAnswer = ViewQueryBlocked | (ChartData & { timedOut: boolean });

/** Answers a Chart view for one person. */
export async function answerChart(db: Executor, query: ViewBase): Promise<ChartAnswer> {
  const prepared = await prepareQuery(db, query);
  if ('blocked' in prepared) return prepared;
  const { input } = prepared;
  // The engine hands over the rows the viewer can open, in view order, and which of them match;
  // the chart keeps the ones its table would count, and no page of rows is made.
  const nested = arrangeFor(query.record, query.view);
  let open: ReadonlyMap<Id, Row> = new Map();
  let counted: Row[] = [];
  input.arrange = (rows, matches) => {
    open = new Map(rows.map((r) => [r.id, r]));
    counted = nested
      ? nested(rows, matches).flatMap((line) => {
          const row = line.context ? undefined : open.get(line.row.id);
          return row ? [row] : [];
        })
      : rows.filter(matches);
    return [];
  };
  const result = runViewQuery(input);
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
  const data = chartData(counted, query.view, context.ctx);
  return { ...data, timedOut: result.timedOut || context.timedOut };
}
