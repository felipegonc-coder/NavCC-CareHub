// POST /:id/chart (decision 0200, W2-3): a Chart view's data for one person. The rows are the ones
// its table would count: the view engine applies row access, the filter (with "Changed for you
// only") and sub-items, and leaves hidden values out. Property access is the view query's: a chart
// that uses a property the viewer can't see answers only { blocked }.
import { chartData, type ChartData } from '@carehub/databases/chart';
import type { ViewQueryBlocked } from '@carehub/databases/engine';
import { prepareQuery, type ViewBase } from './query';
import type { Executor } from './store';
import { countedRows } from './view-context';

/** Chart data, and whether some formula or rollup ran out of time ("⚠ Too slow"). */
export type ChartAnswer = ViewQueryBlocked | (ChartData & { timedOut: boolean });

/** Answers a Chart view for one person. */
export async function answerChart(db: Executor, query: ViewBase): Promise<ChartAnswer> {
  const prepared = await prepareQuery(db, query);
  if ('blocked' in prepared) return prepared;
  const counted = countedRows(query.record, prepared);
  if ('blocked' in counted) return counted;
  const data = chartData(counted.rows, query.view, counted.context.ctx);
  return { ...data, timedOut: counted.timedOut || counted.context.timedOut };
}
